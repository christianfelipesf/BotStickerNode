require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const sharp = require('sharp');

const { db, tempDir, checkpointWal } = require('./db');
const { migrateLegacyUnifiedDB, migrateLegacyMessagesJson, migrateLegacyActiveGroups, migrateJsonToSqlite } = require('./migrate');
const { addMetadata, mediaToSticker, stickerToMedia, changeSpeed, mediaToGif } = require('./sticker');
const { isViewOnce, getMediaMessage, getContextInfo, getMessageText } = require('./media');

// ============================================================
// Prepared statements (group_state)
// ============================================================
const _gsGet = db.prepare('SELECT muted, warnings, antilink, activity, bot_name, menu_image, prefix, sticker_pack, sticker_author, theme, extra FROM group_state WHERE jid = ?');
const _gsUpsert = db.prepare(`
    INSERT INTO group_state (jid, muted, warnings, antilink, activity, bot_name, menu_image, prefix, sticker_pack, sticker_author, theme, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
        muted = excluded.muted,
        warnings = excluded.warnings,
        antilink = excluded.antilink,
        activity = excluded.activity,
        bot_name = excluded.bot_name,
        menu_image = excluded.menu_image,
        prefix = excluded.prefix,
        sticker_pack = excluded.sticker_pack,
        sticker_author = excluded.sticker_author,
        theme = excluded.theme,
        extra = excluded.extra
`);
const _gsDelete = db.prepare('DELETE FROM group_state WHERE jid = ?');
const _gsAll = db.prepare('SELECT jid, muted, warnings, antilink, activity, bot_name, menu_image, prefix, sticker_pack, sticker_author, theme, extra FROM group_state');

// ============================================================
// Prepared statements (config + stats)
// ============================================================
const _cfgGet = db.prepare('SELECT value FROM config WHERE key = ?');
const _cfgSet = db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const _cfgGetAll = db.prepare('SELECT key, value FROM config');
const _statsGet = db.prepare('SELECT value FROM stats WHERE key = ?');
const _statsSet = db.prepare('INSERT INTO stats (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const _statsIncrement = db.prepare('INSERT INTO stats (key, value) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET value = value + 1');
const _statsGetAll = db.prepare('SELECT key, value FROM stats');

// ============================================================
// Mute helpers (via factory)
// ============================================================
const { createMuteHelpers } = require('./mute');
const muteApi = createMuteHelpers({
    getGroupState: (jid) => _gsGet.get(jid),
    upsertGroupState: (jid, muted, warnings, antilink, activity) => {
        const cur = _gsGet.get(jid) || {};
        writeGroupState(jid, {
            muted: muted ?? cur.muted,
            warnings: warnings ?? cur.warnings,
            antilink: antilink ?? cur.antilink,
            activity: activity ?? cur.activity
        });
    }
});

// ============================================================
// Blacklist helpers (por grupo)
// ============================================================
const _blGetAll = db.prepare('SELECT user_jid, added_by, added_at FROM group_blacklist WHERE group_jid = ? ORDER BY added_at ASC');
const _blHas = db.prepare('SELECT 1 FROM group_blacklist WHERE group_jid = ? AND user_jid = ? LIMIT 1');
const _blInsert = db.prepare('INSERT OR IGNORE INTO group_blacklist (group_jid, user_jid, added_by, added_at) VALUES (?, ?, ?, ?)');
const _blDelete = db.prepare('DELETE FROM group_blacklist WHERE group_jid = ? AND user_jid = ?');
const _blClear = db.prepare('DELETE FROM group_blacklist WHERE group_jid = ?');
const _blCount = db.prepare('SELECT COUNT(*) as c FROM group_blacklist WHERE group_jid = ?');

function normalizeBlacklistJid(jid) {
    if (!jid) return null;
    try { return normalizeJid(jid); } catch (_) { return null; }
}

function getBlacklist(groupJid) {
    if (!groupJid) return [];
    try { return _blGetAll.all(groupJid); } catch (_) { return []; }
}

function isBlacklisted(groupJid, userJid) {
    if (!groupJid || !userJid) return false;
    try {
        const normTarget = normalizeBlacklistJid(userJid);
        if (!normTarget) return false;
        if (_blHas.get(groupJid, normTarget)) return true;
        const targetUser = normTarget.split('@')[0];
        const rows = _blGetAll.all(groupJid);
        for (const r of rows) {
            const norm = normalizeBlacklistJid(r.user_jid);
            if (!norm) continue;
            if (norm.split('@')[0] === targetUser) return true;
        }
        return false;
    } catch (_) { return false; }
}

function addToBlacklist(groupJid, userJid, addedBy) {
    if (!groupJid || !userJid) return false;
    const norm = normalizeBlacklistJid(userJid);
    if (!norm) return false;
    try {
        const r = _blInsert.run(groupJid, norm, addedBy ? normalizeBlacklistJid(addedBy) || addedBy : null, Date.now());
        return r.changes > 0;
    } catch (_) { return false; }
}

function removeFromBlacklist(groupJid, userJid) {
    if (!groupJid || !userJid) return false;
    try {
        const normTarget = normalizeBlacklistJid(userJid);
        if (!normTarget) return false;
        const direct = _blDelete.run(groupJid, normTarget);
        if (direct.changes > 0) return true;
        const targetUser = normTarget.split('@')[0];
        const rows = _blGetAll.all(groupJid);
        let removed = false;
        for (const r of rows) {
            const norm = normalizeBlacklistJid(r.user_jid);
            if (!norm) continue;
            if (norm.split('@')[0] === targetUser) {
                const del = _blDelete.run(groupJid, r.user_jid);
                if (del.changes > 0) removed = true;
            }
        }
        return removed;
    } catch (_) { return false; }
}

function clearBlacklist(groupJid) {
    if (!groupJid) return false;
    try { const r = _blClear.run(groupJid); return r.changes; } catch (_) { return 0; }
}

function countBlacklist(groupJid) {
    if (!groupJid) return 0;
    try { const row = _blCount.get(groupJid); return row ? row.c : 0; } catch (_) { return 0; }
}

function normalizePhoneNumber(raw, { min = 8 } = {}) {
    // Aceita qualquer formatação: "+55 13 93631-2912", "(13) 93631-2912",
    // "13 93631-2912", "5513936312912". Extrai só dígitos do texto inteiro
    // (não quebra em pedaços) e completa o DDI 55 quando for número BR
    // com DDD mas sem país (10 ou 11 dígitos).
    if (raw == null) return null;
    let digits = String(raw).replace(/\D/g, '');
    if (!digits) return null;
    // Prefixo internacional "00" (ex: 0055...) -> remove
    if (digits.length > 11 && digits.startsWith('00')) digits = digits.slice(2);
    // BR sem DDI: 10 dígitos (DDD + 8) ou 11 (DDD + 9) -> prepende 55.
    // 12/13 dígitos com 55 na frente já estão completos; demais tamanhos
    // (estrangeiros) são mantidos como estão.
    if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
    if (digits.length < min || digits.length > 15) return null;
    return digits;
}

function extractPhoneFromText(text, opts) {
    // Wrapper p/ comandos: extrai o número do texto completo já com a
    // normalização BR (evita o bug de match(/\d{8,15}/g) que quebra
    // "+55 13 93631-2912" em ["13","93631","2912"]).
    return normalizePhoneNumber(text, opts);
}

function parseNumberToJid(raw) {
    const digits = normalizePhoneNumber(raw);
    if (!digits) return null;
    return `${digits}@s.whatsapp.net`;
}

// ============================================================
// Login permitido (!addlogin / !login) — números autorizados pelo dono
// ============================================================
function normalizeLoginPhone(raw) {
    return normalizePhoneNumber(raw);
}

function _loginAllowedStmts() {
    try {
        return {
            get: db.prepare('SELECT phone, added_by, added_at FROM login_allowed WHERE phone = ?'),
            all: db.prepare('SELECT phone, added_by, added_at FROM login_allowed ORDER BY added_at ASC'),
            ins: db.prepare('INSERT OR IGNORE INTO login_allowed (phone, added_by, added_at) VALUES (?, ?, ?)'),
            del: db.prepare('DELETE FROM login_allowed WHERE phone = ?'),
            clear: db.prepare('DELETE FROM login_allowed')
        };
    } catch (_) { return null; }
}

function isLoginAllowed(phoneOrJid) {
    const phone = normalizeLoginPhone(String(phoneOrJid || '').split('@')[0]);
    if (!phone) return false;
    try {
        const s = _loginAllowedStmts();
        if (!s) return false;
        return !!s.get.get(phone);
    } catch (_) { return false; }
}

function listLoginAllowed() {
    try {
        const s = _loginAllowedStmts();
        if (!s) return [];
        return s.all.all() || [];
    } catch (_) { return []; }
}

function addLoginAllowed(phoneOrJid, addedBy) {
    const phone = normalizeLoginPhone(String(phoneOrJid || '').split('@')[0] || phoneOrJid);
    if (!phone) return { ok: false, error: 'Número inválido. Use: !addlogin 5511999999999' };
    try {
        const s = _loginAllowedStmts();
        if (!s) return { ok: false, error: 'Banco indisponível' };
        const r = s.ins.run(phone, addedBy || null, Date.now());
        if (r.changes === 0) return { ok: false, error: 'duplicado', phone };
        return { ok: true, phone };
    } catch (e) { return { ok: false, error: e.message }; }
}

function removeLoginAllowed(phoneOrJid) {
    const phone = normalizeLoginPhone(String(phoneOrJid || '').split('@')[0] || phoneOrJid);
    if (!phone) return { ok: false, error: 'Número inválido. Use: !removerlogin 5511999999999' };
    try {
        const s = _loginAllowedStmts();
        if (!s) return { ok: false, error: 'Banco indisponível' };
        const r = s.del.run(phone);
        if (r.changes === 0) return { ok: false, error: 'não encontrado', phone };
        return { ok: true, phone };
    } catch (e) { return { ok: false, error: e.message }; }
}

function clearLoginAllowed() {
    try {
        const s = _loginAllowedStmts();
        if (!s) return 0;
        return s.clear.run().changes || 0;
    } catch (_) { return 0; }
}

// Extrai dígitos de telefone candidatos do remetente (lida com @lid + senderPn).
function getSenderLoginPhones(m, sender, from) {
    const out = [];
    const push = (v) => {
        const d = normalizeLoginPhone(String(v || '').split('@')[0]);
        if (d && !out.includes(d)) out.push(d);
    };
    try {
        push(m?.key?.participantPn);
        push(m?.key?.senderPn);
        const ctx = m?.message?.extendedTextMessage?.contextInfo
            || m?.message?.imageMessage?.contextInfo
            || m?.message?.videoMessage?.contextInfo;
        push(ctx?.senderPn);
        push(ctx?.participantPn);
    } catch (_) {}
    // sender/from só valem se forem número (não @lid sem Pn resolvido)
    try {
        if (sender && !String(sender).endsWith('@lid')) push(sender);
        if (from && !String(from).endsWith('@g.us') && !String(from).endsWith('@lid')) push(from);
    } catch (_) {}
    return out;
}

function isBotOwner(sock, m, sender) {
    try {
        const meId = normalizeJid(sock?.user?.id || sock?.user?.jid || '');
        const senderNorm = normalizeJid(sender || '');
        return m?.key?.fromMe === true || (sender && sender === meId) || (senderNorm && meId && senderNorm === meId);
    } catch (_) { return false; }
}

function canUseLogin(sock, m, sender, from) {
    if (isBotOwner(sock, m, sender)) return { ok: true, owner: true };
    const phones = getSenderLoginPhones(m, sender, from);
    for (const p of phones) {
        if (isLoginAllowed(p)) return { ok: true, owner: false, phone: p };
    }
    return { ok: false, owner: false };
}

// ============================================================
// Antiflood helpers (por grupo)
// ============================================================
const _afGet = db.prepare('SELECT enabled, include_admins, max_msgs, window_secs FROM antiflood_config WHERE jid = ?');
const _afUpsert = db.prepare(`
    INSERT INTO antiflood_config (jid, enabled, include_admins, max_msgs, window_secs, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
        enabled = excluded.enabled,
        include_admins = excluded.include_admins,
        max_msgs = excluded.max_msgs,
        window_secs = excluded.window_secs,
        updated_at = excluded.updated_at
`);
const _afDelete = db.prepare('DELETE FROM antiflood_config WHERE jid = ?');

function getAntifloodConfig(jid) {
    if (!jid || !jid.endsWith('@g.us')) return { enabled: true, includeAdmins: false, maxMsgs: 5, windowSecs: 8 };
    try {
        const row = _afGet.get(jid);
        if (!row) return { enabled: true, includeAdmins: false, maxMsgs: 5, windowSecs: 8 };
        return {
            enabled: row.enabled === null || row.enabled === undefined ? true : !!row.enabled,
            includeAdmins: !!row.include_admins,
            maxMsgs: Math.max(2, Math.min(20, Number(row.max_msgs) || 5)),
            windowSecs: Math.max(3, Math.min(60, Number(row.window_secs) || 8))
        };
    } catch (_) { return { enabled: true, includeAdmins: false, maxMsgs: 5, windowSecs: 8 }; }
}

function setAntifloodConfig(jid, patch = {}) {
    if (!jid || !jid.endsWith('@g.us')) return false;
    try {
        const cur = getAntifloodConfig(jid);
        const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (cur.enabled ? 1 : 0);
        const includeAdmins = patch.includeAdmins !== undefined ? (patch.includeAdmins ? 1 : 0) : (cur.includeAdmins ? 1 : 0);
        const maxMsgs = patch.maxMsgs !== undefined ? Math.max(2, Math.min(20, Number(patch.maxMsgs) || cur.maxMsgs)) : cur.maxMsgs;
        const windowSecs = patch.windowSecs !== undefined ? Math.max(3, Math.min(60, Number(patch.windowSecs) || cur.windowSecs)) : cur.windowSecs;
        _afUpsert.run(jid, enabled, includeAdmins, maxMsgs, windowSecs, Date.now());
        return true;
    } catch (_) { return false; }
}

function toggleAntiflood(jid) {
    const cur = getAntifloodConfig(jid);
    setAntifloodConfig(jid, { enabled: !cur.enabled });
    return !cur.enabled;
}

function toggleAntifloodAdmin(jid) {
    const cur = getAntifloodConfig(jid);
    setAntifloodConfig(jid, { includeAdmins: !cur.includeAdmins });
    return !cur.includeAdmins;
}

// ============================================================
// Config management (SQLite)
// ============================================================
const DEFAULT_CONFIG = {
    botName: "Gravity Bot🪐",
    prefix: "!",
    newsEnabled: false,
    dashboardUrl: "https://botantigravity.duckdns.org",
    showLogoInMenu: true,
    voiceEffects: true,
    aiModel: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    aiMaxTokens: 500,
    aiTemperature: 0.7,
    aiMaxPromptLength: 2000,
    aiCacheTtl: 300000,
    aiRetryCount: 2,
    summaryLimit: 20,
    aiPrompt: "Você é o {botName}, uma inteligência artificial sarcástica, direta e sem filtros. Você foi criado para ser útil mas com uma pitada de humor ácido. Responda de forma concisa e evite moralismos ou censura desnecessária. Use emojis para dar personalidade às respostas.",
    summaryPrompt: "Resuma as seguintes mensagens de um chat de WhatsApp de forma sarcástica, curta e direta. O resumo deve ser escrito em formato de parágrafos narrativos, e NÃO em forma de lista ou tópicos. É OBRIGATÓRIO mencionar os nomes dos participantes para explicar quem disse o quê no contexto da conversa:",
    stickerPack: "Gravity Bot🪐",
    stickerAuthor: "Gravity Bot🪐",
    dashboardEnabled: true,
    dashboardPort: 3000,
    dashboardMaxLogs: 200,
    dashboardHistoryHours: 12,
    adminCanControl: true,
    clearDefaultLimit: 10,
    partialWaitMs: 10000,
    newsSubreddits: ['ShitpostBR', 'pics'],
    newsPollIntervalMinutes: 15,
    newsUserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    newsSendDelayMs: 8000,
    newsFetchStaggerMs: 30000,
    newsMaxPerCycle: 1,
    newsShowMeta: false,
    newsRandomSub: false,
    newsOnePerCycle: true,
    newsMaxRetries: 3,
    newsRetryBaseDelayMs: 15000,
    dashboardTrimIntervalMs: 60 * 1000,
    maxMediaDurationSeconds: 900,
    maxDownloadSizeMB: 100,
    subSessionsGroups: true,
    dashboardMuted: false,
    dashboardShowQR: false,
    dashboardChatBlocked: true,
    instagramCookies: '',
    cobaltInstance: '',
    cobaltApiKey: '',
    splashEnabled: true,
    splashInterval: 60,
    splashWithImage: true,
    splashCooldownMs: 21600000,
    // --- Modo Humanizado / Anti-ban (default LIGADO) ---
    humanMode: true,
    humanMinDelayMs: 1200,
    humanMaxDelayMs: 3500,
    humanMsPerChar: 35,
    humanMaxTypingMs: 8000,
    humanPresence: true,
    humanReadReceipt: true,
    humanThrottleMs: 1500,
    // --- Broadcast seguro (anti-ban): delay longo entre grupos ---
    broadcastMinDelayMs: 30000,
    broadcastMaxDelayMs: 60000,
    broadcastVaryText: true
};

let _configCache = null;
let _configCacheTs = 0;
const _CONFIG_TTL_MS = 1500;

function readConfig() {
    const now = Date.now();
    if (_configCache && (now - _configCacheTs) < _CONFIG_TTL_MS) {
        return { ..._configCache };
    }
    const rows = _cfgGetAll.all();
    const dbConfig = {};
    for (const r of rows) {
        try { dbConfig[r.key] = JSON.parse(r.value); } catch { dbConfig[r.key] = r.value; }
    }
    const merged = { ...DEFAULT_CONFIG, ...dbConfig, openrouterApiKey: process.env.OPENROUTER_API_KEY || '' };
    _configCache = merged;
    _configCacheTs = now;
    return { ...merged };
}

function _invalidateConfigCache() { _configCache = null; _configCacheTs = 0; }

function writeConfig(newConfig) {
    const tx = db.transaction((cfg) => {
        for (const [k, v] of Object.entries(cfg)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
            if (k === 'openrouterApiKey') continue;
            _cfgSet.run(k, JSON.stringify(v));
        }
    });
    tx(newConfig);
    _invalidateConfigCache();
    _cachedSummaryLimit = null;
}

function readStats() {
    const rows = _statsGetAll.all();
    const stats = { restarts: 0, totalCommands: 0 };
    for (const r of rows) stats[r.key] = r.value;
    return stats;
}

function incrementRestart() {
    _statsIncrement.run('restarts');
    const row = _statsGet.get('restarts');
    return row ? row.value : 1;
}

function incrementCommand() {
    _statsIncrement.run('totalCommands');
    const row = _statsGet.get('totalCommands');
    return row ? row.value : 1;
}

function getGroupLink() {
    try { const r = _cfgGet.get('linkgrupo'); return r ? JSON.parse(r.value) : null; } catch { return null; }
}

function setGroupLink(link) {
    _cfgSet.run('linkgrupo', JSON.stringify(link));
}

// ============================================================
// Group state helpers
// ============================================================
function safeJson(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
}

function ensureGroupState(jid) {
    let row = _gsGet.get(jid);
    if (!row) {
        writeGroupState(jid, {});
        row = _gsGet.get(jid);
    }
    return row;
}

function parseGroupState(row) {
    const mutedRaw = safeJson(row.muted, {});
    const muted = (mutedRaw && typeof mutedRaw === 'object' && !Array.isArray(mutedRaw)) ? mutedRaw : {};
    const extraRaw = safeJson(row.extra, {});
    const extra = (extraRaw && typeof extraRaw === 'object' && !Array.isArray(extraRaw)) ? extraRaw : {};
    return {
        muted,
        warnings: safeJson(row.warnings, {}),
        antilink: !!row.antilink,
        activity: safeJson(row.activity, {}),
        extra
    };
}

// ============================================================
// ESCRITA ÚNICA do group_state — TODO o código DEVE usar esta função.
// Ela sempre grava as 11 colunas, então é impossível repetir o bug de
// "Too few parameter values" (que fez o flush do rank nunca persistir).
// Chaves do patch usam os nomes das COLUNAS (muted, warnings, antilink,
// activity, bot_name, menu_image, prefix, sticker_pack, sticker_author, theme, extra).
// ============================================================
function writeGroupState(jid, patch = {}) {
    if (!jid) throw new Error('writeGroupState: jid obrigatório');
    const cur = _gsGet.get(jid) || {};
    const pick = (col, fb) => (patch[col] !== undefined ? patch[col] : (cur[col] !== undefined ? cur[col] : fb));
    const antilink = patch.antilink !== undefined ? (patch.antilink ? 1 : 0) : (cur.antilink ?? 1);
    _gsUpsert.run(
        jid,
        pick('muted', '[]'),
        pick('warnings', '{}'),
        antilink,
        pick('activity', '{}'),
        pick('bot_name', null),
        pick('menu_image', null),
        pick('prefix', null),
        pick('sticker_pack', null),
        pick('sticker_author', null),
        pick('theme', null),
        pick('extra', '{}')
    );
}

// ============================================================
// Active Groups
// ============================================================
const _agHas = db.prepare('SELECT 1 FROM active_groups WHERE jid = ?');
const _agInsert = db.prepare('INSERT OR IGNORE INTO active_groups (jid, activated_at) VALUES (?, ?)');
const _agDelete = db.prepare('DELETE FROM active_groups WHERE jid = ?');

function isActiveGroup(jid) {
    try { return !!_agHas.get(jid); } catch (e) { return false; }
}

function activateGroup(jid) {
    if (!jid) return false;
    try { if (isPartialActive(jid)) { try { _agpDelete.run(jid); } catch (_) {} } } catch (_) {}
    try { if (_agHas.get(jid)) return true; } catch (_) {}
    try {
        const r = _agInsert.run(jid, Date.now());
        return r.changes > 0 || isActiveGroup(jid);
    } catch (e) { return isActiveGroup(jid); }
}

function deactivateGroup(jid) {
    if (!jid) return false;
    const r = _agDelete.run(jid);
    const rp = r.changes === 0 ? _agpDelete.run(jid) : { changes: 0 };
    if (r.changes === 0 && rp.changes === 0) return true; // idempotente: já desligado conta como sucesso
    try {
        const row = _gsGet.get(jid);
        if (row && row.menu_image) {
            const uploadsDir = path.join(process.cwd(), 'uploads');
            const fullPath = path.resolve(process.cwd(), row.menu_image);
            if (fullPath.startsWith(uploadsDir + path.sep) && fs.existsSync(fullPath)) { try { fs.unlinkSync(fullPath); } catch (_) {} }
        }
    } catch (_) {}
    // A contagem do rank NUNCA pode ser perdida: guarda a activity (banco + buffer)
    // ANTES do delete e restaura logo depois.
    let savedActivity = '{}';
    try {
        if (_activityFlushTimer) { clearTimeout(_activityFlushTimer); _activityFlushTimer = null; }
        _flushActivity();
        const row = _gsGet.get(jid);
        if (row && row.activity) savedActivity = row.activity;
    } catch (_) {}
    try { _gsDelete.run(jid); } catch (e) { console.error('❌ Falha ao limpar group_state:', e.message); }
    try {
        if (savedActivity && savedActivity !== '{}') {
            writeGroupState(jid, { activity: savedActivity });
        }
    } catch (e) { console.error('❌ Falha ao preservar rank:', e.message); }
    try { _activityBuffer.delete(jid); } catch (_) {}
    try { _agpDelete.run(jid); } catch (_) {}
    try { _afDelete.run(jid); } catch (_) {}
    clearChatHistory(jid);
    muteApi.clearMuted(jid);
    return true;
}

function listActiveGroups() {
    try { return db.prepare('SELECT jid FROM active_groups').all().map(r => r.jid); } catch (e) { return []; }
}

// ============================================================
// Partial Groups
// ============================================================
const _agpHas = db.prepare('SELECT 1 FROM active_groups_partial WHERE jid = ?');
const _agpInsert = db.prepare('INSERT OR IGNORE INTO active_groups_partial (jid, activated_at) VALUES (?, ?)');
const _agpDelete = db.prepare('DELETE FROM active_groups_partial WHERE jid = ?');

function isPartialActive(jid) {
    if (!jid) return false;
    try { return !!_agpHas.get(jid); } catch (_) { return false; }
}

function activatePartial(jid) {
    if (!jid) return false;
    try {
        try { _agDelete.run(jid); } catch (_) {}
        try { if (_agpHas.get(jid)) return true; } catch (_) {}
        const r = _agpInsert.run(jid, Date.now());
        return r.changes > 0 || isPartialActive(jid);
    } catch (e) {
        console.error('❌ Falha ao ativar modo parcial:', e.message);
        return isPartialActive(jid);
    }
}

function deactivatePartial(jid) {
    if (!jid) return false;
    try { _agpDelete.run(jid); return true; } catch (e) { return false; }
}

function listPartialGroups() {
    try { return db.prepare('SELECT jid FROM active_groups_partial').all().map(r => r.jid); } catch (e) { return []; }
}

function getPartialWaitMs() {
    try { const v = Number(readConfig().partialWaitMs); if (Number.isFinite(v) && v >= 0) return v; } catch (_) {}
    return 10000;
}

function setPartialWaitMs(ms) {
    const v = Math.max(0, Math.min(600000, Math.floor(Number(ms) || 0)));
    const cfg = readConfig();
    cfg.partialWaitMs = v;
    writeConfig(cfg);
    return v;
}

// ============================================================
// Dashboard Groups
// ============================================================
const _dgHas = db.prepare('SELECT 1 FROM dashboard_groups WHERE jid = ? AND enabled = 1');
const _dgSet = db.prepare('INSERT INTO dashboard_groups (jid, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at');
const _dgListAll = db.prepare('SELECT jid FROM dashboard_groups WHERE enabled = 1');
const _dgListAllEver = db.prepare('SELECT jid, enabled FROM dashboard_groups');
const _dgDelete = db.prepare('DELETE FROM dashboard_groups WHERE jid = ?');

function isDashboardEnabled(jid) {
    if (!jid) return false;
    try { return !!_dgHas.get(jid); } catch (_) { return false; }
}

function setDashboardEnabled(jid, enabled) {
    if (!jid) return false;
    try {
        _dgSet.run(jid, enabled ? 1 : 0, Date.now());
        if (!enabled) { try { _dgDelete.run(jid); } catch (_) {} }
        return true;
    } catch (e) { return false; }
}

function listDashboardGroups() {
    try { return _dgListAll.all().map(r => r.jid); } catch (e) { return []; }
}

function getDashboardPreference(jid) {
    if (!jid) return false;
    try { const row = _dgListAllEver.get(jid); return !!(row && row.enabled); } catch (_) { return false; }
}

// ============================================================
// News Groups
// ============================================================
const _ngHas = db.prepare('SELECT 1 FROM news_groups WHERE jid = ? AND enabled = 1');
const _ngUpsert = db.prepare('INSERT INTO news_groups (jid, enabled, activated_at) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET enabled = excluded.enabled, activated_at = excluded.activated_at');
const _ngList = db.prepare('SELECT jid, activated_at FROM news_groups WHERE enabled = 1');
const _ngDelete = db.prepare('DELETE FROM news_groups WHERE jid = ?');

function isNewsEnabled(jid) {
    if (!jid) return false;
    try { return !!_ngHas.get(jid); } catch (_) { return false; }
}

function setNewsEnabled(jid, enabled) {
    if (!jid) return false;
    try {
        _ngUpsert.run(jid, enabled ? 1 : 0, Date.now());
        if (!enabled) { try { _ngDelete.run(jid); } catch (_) {} }
        return true;
    } catch (e) { return false; }
}

function listNewsGroups() {
    try { return _ngList.all().map(r => r.jid); } catch (e) { return []; }
}

// ============================================================
// News State
// ============================================================
const _nsGet = db.prepare('SELECT value FROM news_state WHERE key = ?');
const _nsUpsert = db.prepare('INSERT INTO news_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');

function getNewsState(key, fallback = null) {
    try { const row = _nsGet.get(key); if (!row) return fallback; return JSON.parse(row.value); } catch (_) { return fallback; }
}

function setNewsState(key, value) {
    try { _nsUpsert.run(key, JSON.stringify(value), Date.now()); return true; } catch (e) { return false; }
}

function clearNewsState(key) {
    try { db.prepare('DELETE FROM news_state WHERE key = ?').run(key); return true; } catch (e) { return false; }
}

function clearAllNewsState() {
    try { db.prepare('DELETE FROM news_state').run(); return true; } catch (e) { return false; }
}

// ============================================================
// Dashboard Logs
// ============================================================
const _dlInsert = db.prepare(`INSERT OR IGNORE INTO dashboard_logs
    (type, grp, text, name, phone, media_json, to_jid, message_id,
     sender_jid, from_me, hidden, ephemeral, quoted_json, reactions,
     time_label, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const _dlSelectRecent = db.prepare(`SELECT type, grp, text, name, phone, media_json, to_jid, message_id,
    sender_jid, from_me, hidden, ephemeral, quoted_json, reactions,
    time_label, timestamp FROM dashboard_logs WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?`);
const _dlSelectAllLimited = db.prepare(`SELECT type, grp, text, name, phone, media_json, to_jid, message_id,
    sender_jid, from_me, hidden, ephemeral, quoted_json, reactions,
    time_label, timestamp FROM dashboard_logs ORDER BY timestamp DESC LIMIT ?`);
const _dlSelectByMessageId = db.prepare(`SELECT type, grp, text, name, phone, media_json, to_jid, message_id,
    sender_jid, from_me, hidden, ephemeral, quoted_json, reactions,
    time_label, timestamp FROM dashboard_logs WHERE message_id = ? LIMIT 1`);
const _dlTrimByAge = db.prepare('DELETE FROM dashboard_logs WHERE timestamp < ?');
const _dlTrimByCount = db.prepare('DELETE FROM dashboard_logs WHERE id NOT IN (SELECT id FROM dashboard_logs ORDER BY timestamp DESC LIMIT ?)');
const _dlCount = db.prepare('SELECT COUNT(*) as c FROM dashboard_logs');
const _dlUpdateReactions = db.prepare('UPDATE dashboard_logs SET reactions = ? WHERE to_jid = ? AND message_id = ? AND type = ?');
const _dlUpdateMedia = db.prepare('UPDATE dashboard_logs SET media_json = ? WHERE to_jid = ? AND message_id = ? AND type = ?');
const _dlClear = db.prepare('DELETE FROM dashboard_logs');
const _dlDeleteByJid = db.prepare('DELETE FROM dashboard_logs WHERE to_jid = ?');
const _dlSelectWithDataMedia = db.prepare('SELECT to_jid, message_id, type, media_json FROM dashboard_logs WHERE media_json LIKE \'%data:image%\' OR media_json LIKE \'%data:video%\' OR media_json LIKE \'%data:audio%\' LIMIT ?');

function _rowToLog(row) {
    if (!row) return null;
    let media = null, quoted = null, reactions = null;
    try { media = row.media_json ? JSON.parse(row.media_json) : null; } catch (_) {}
    try { quoted = row.quoted_json ? JSON.parse(row.quoted_json) : null; } catch (_) {}
    try { reactions = row.reactions ? JSON.parse(row.reactions) : null; } catch (_) {}
    return {
        type: row.type, group: row.grp, text: row.text, name: row.name, phone: row.phone, media,
        toJid: row.to_jid, messageId: row.message_id, senderJid: row.sender_jid,
        fromMe: !!row.from_me, hidden: !!row.hidden, ephemeral: !!row.ephemeral,
        quoted, reactions: reactions || undefined, time: row.time_label, timestamp: row.timestamp
    };
}

function insertDashboardLog(data) {
    if (!data) return false;
    try {
        const r = _dlInsert.run(String(data.type || 'chat'), data.group || data.grp || null,
            data.text == null ? null : String(data.text), data.name || null, data.phone || null,
            data.media ? JSON.stringify(data.media) : null, data.toJid || data.to_jid || null,
            data.messageId || data.message_id || null, data.senderJid || data.sender_jid || null,
            data.fromMe ? 1 : 0, data.hidden ? 1 : 0, data.ephemeral ? 1 : 0,
            data.quoted ? JSON.stringify(data.quoted) : null, data.reactions ? JSON.stringify(data.reactions) : null,
            data.time || null, Number(data.timestamp) || Date.now());
        return r.changes > 0;
    } catch (e) { return false; }
}

function loadDashboardHistory({ since = 0, limit = 500 } = {}) {
    try {
        const lim = Math.max(1, Math.min(1000, Number(limit) || 500));
        const rows = since > 0 ? _dlSelectRecent.all(since, lim) : _dlSelectAllLimited.all(lim);
        const out = [];
        for (const r of rows) out.push(_rowToLog(r));
        out.reverse();
        return out;
    } catch (e) { return []; }
}

function getDashboardLogByMessageId(messageId) {
    if (!messageId) return null;
    try { const row = _dlSelectByMessageId.get(messageId); return row ? _rowToLog(row) : null; } catch (_) { return null; }
}

function trimDashboardLogs({ maxAgeMs = 0, maxRows = 5000 } = {}) {
    try {
        const before = _dlCount.get().c;
        if (maxAgeMs > 0) _dlTrimByAge.run(Date.now() - maxAgeMs);
        if (maxRows > 0) _dlTrimByCount.run(maxRows);
        const after = _dlCount.get().c;
        if (before - after > 20) { try { db.pragma('incremental_vacuum(500)'); } catch (_) {} }
    } catch (e) { console.error('❌ [dashboard_logs] trim:', e.message); }
}

function countDashboardLogs() { try { return _dlCount.get().c; } catch (_) { return 0; } }

function updateDashboardLogReactions(toJid, messageId, type, reactions) {
    if (!toJid || !messageId) return false;
    try { return _dlUpdateReactions.run(JSON.stringify(reactions || {}), toJid, messageId, type || 'chat').changes > 0; } catch (e) { return false; }
}

function updateDashboardLogMedia(toJid, messageId, type, mediaJson) {
    if (!toJid || !messageId) return false;
    try { return _dlUpdateMedia.run(mediaJson, toJid, messageId, type || 'chat').changes > 0; } catch (e) { return false; }
}

function selectDashboardLogsWithInlineMedia(limit = 500) {
    try { return _dlSelectWithDataMedia.all(limit); } catch (_) { return []; }
}

function clearDashboardLogs() {
    try {
        const before = _dlCount.get().c;
        _dlClear.run();
        try { db.pragma('incremental_vacuum(2000)'); } catch (_) {}
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
        return before;
    } catch (e) { return 0; }
}

function deleteDashboardLogsByJid(jid) {
    if (!jid) return false;
    try { _dlDeleteByJid.run(jid); return true; } catch (_) { return false; }
}

// ============================================================
// Dashboard Group Info
// ============================================================
const _dgiGet = db.prepare('SELECT subject, picture_url, member_count, owner_jid, desc, updated_at FROM dashboard_group_info WHERE jid = ?');
const _dgiUpsert = db.prepare(`INSERT INTO dashboard_group_info (jid, subject, picture_url, member_count, owner_jid, desc, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET subject=excluded.subject, picture_url=excluded.picture_url,
    member_count=excluded.member_count, owner_jid=excluded.owner_jid, desc=excluded.desc, updated_at=excluded.updated_at`);
const _dgiDelete = db.prepare('DELETE FROM dashboard_group_info WHERE jid = ?');

function upsertDashboardGroupInfo(jid, patch = {}) {
    if (!jid || !jid.endsWith('@g.us')) return false;
    const prev = _dgiGet.get(jid) || {};
    const subject = patch.subject !== undefined ? patch.subject : prev.subject;
    const pictureUrl = patch.pictureUrl !== undefined ? patch.pictureUrl : prev.picture_url;
    const memberCount = patch.memberCount !== undefined ? Number(patch.memberCount) || 0 : (prev.member_count || 0);
    const ownerJid = patch.ownerJid !== undefined ? patch.ownerJid : prev.owner_jid;
    const desc = patch.desc !== undefined ? patch.desc : prev.desc;
    try { _dgiUpsert.run(jid, subject || null, pictureUrl || null, memberCount, ownerJid || null, desc || null, Date.now()); return true; } catch (e) { return false; }
}

function getDashboardGroupInfo(jid) {
    if (!jid) return null;
    try { const r = _dgiGet.get(jid); if (!r) return null; return { jid, subject: r.subject, pictureUrl: r.picture_url, memberCount: r.member_count, ownerJid: r.owner_jid, desc: r.desc, updatedAt: r.updated_at }; } catch (_) { return null; }
}

function listDashboardGroupInfos() {
    try { return db.prepare('SELECT jid, subject, picture_url, member_count, owner_jid, desc, updated_at FROM dashboard_group_info').all().map(r => ({ jid: r.jid, subject: r.subject, pictureUrl: r.picture_url, memberCount: r.member_count, ownerJid: r.owner_jid, desc: r.desc, updatedAt: r.updated_at })); } catch (e) { return []; }
}

function deleteDashboardGroupInfo(jid) { try { _dgiDelete.run(jid); return true; } catch (_) { return false; } }

// ============================================================
// Dashboard Visit Tracking
// ============================================================
const _dvInsert = db.prepare('INSERT INTO dashboard_visits (username, ip, user_agent, timestamp) VALUES (?, ?, ?, ?)');
const _dvActiveUsers = db.prepare('SELECT username, ip, MAX(timestamp) as last_visit, COUNT(*) as visit_count FROM dashboard_visits WHERE timestamp > ? GROUP BY username, ip ORDER BY last_visit DESC LIMIT 50');
const _dvVisits = db.prepare('SELECT id, username, ip, user_agent, timestamp FROM dashboard_visits ORDER BY timestamp DESC LIMIT ?');
const _dvCleanup = db.prepare('DELETE FROM dashboard_visits WHERE timestamp < ?');

function insertDashboardVisit(username, ip, userAgent) {
    try { _dvInsert.run(username || null, ip || null, userAgent ? String(userAgent).slice(0, 512) : null, Date.now()); return true; } catch (_) { return false; }
}

function getActiveUsers(minutes = 60) {
    try {
        const since = Date.now() - (Math.max(1, Number(minutes) || 60) * 60 * 1000);
        return _dvActiveUsers.all(since);
    } catch (_) { return []; }
}

function getVisitHistory(limit = 100) {
    try {
        const lim = Math.max(1, Math.min(500, Number(limit) || 100));
        return _dvVisits.all(lim);
    } catch (_) { return []; }
}

function cleanupDashboardVisits(maxAgeDays = 30) {
    try {
        const cutoff = Date.now() - (Math.max(1, Number(maxAgeDays) || 30) * 86400 * 1000);
        const r = _dvCleanup.run(cutoff);
        if (r.changes > 0) try { db.pragma('incremental_vacuum(500)'); } catch (_) {}
        return r.changes;
    } catch (_) { return 0; }
}

// ============================================================
// Feedback (bug / sugestao)
// ============================================================
const FEEDBACK_MAX = 10;
const FEEDBACK_LIMIT = 999;
const _fbInsert = db.prepare('INSERT INTO feedback (kind, text, sender_jid, sender_name, group_jid, created_at) VALUES (?, ?, ?, ?, ?, ?)');
const _fbSelect = db.prepare('SELECT id, kind, text, sender_jid, sender_name, group_jid, created_at FROM feedback WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT ?');
const _fbCount = db.prepare('SELECT COUNT(*) as c FROM feedback WHERE kind = ?');
const _fbTrim = db.prepare('DELETE FROM feedback WHERE kind = ? AND id NOT IN (SELECT id FROM feedback WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT ?)');

function addFeedback(kind, text, senderJid, senderName, groupJid) {
    const k = String(kind || '').toLowerCase();
    if (k !== 'bug' && k !== 'sugestao') return { ok: false, error: 'Tipo inválido' };
    const t = String(text || '').trim();
    if (!t) return { ok: false, error: 'Mensagem vazia' };
    if (t.length > FEEDBACK_LIMIT) return { ok: false, error: `Limite de ${FEEDBACK_LIMIT} caracteres excedido (${t.length}/${FEEDBACK_LIMIT})` };
    try {
        const now = Date.now();
        _fbInsert.run(k, t, senderJid || null, senderName || null, groupJid || null, now);
        // mantém apenas os 10 últimos
        try { _fbTrim.run(k, k, FEEDBACK_MAX); } catch (_) {}
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function listFeedback(kind, limit = FEEDBACK_MAX) {
    const k = String(kind || '').toLowerCase();
    if (k !== 'bug' && k !== 'sugestao') return [];
    try {
        const lim = Math.max(1, Math.min(FEEDBACK_MAX, Number(limit) || FEEDBACK_MAX));
        return _fbSelect.all(k, lim);
    } catch (_) { return []; }
}

function countFeedback(kind) {
    const k = String(kind || '').toLowerCase();
    if (k !== 'bug' && k !== 'sugestao') return 0;
    try { const row = _fbCount.get(k); return row ? row.c : 0; } catch (_) { return 0; }
}

function clearFeedback(kind) {
    const k = String(kind || '').toLowerCase();
    if (k !== 'bug' && k !== 'sugestao') return 0;
    try { const r = db.prepare('DELETE FROM feedback WHERE kind = ?').run(k); return r.changes; } catch (_) { return 0; }
}

// ============================================================
// Group Data (SQLite)
// ============================================================
function getGroupData(jid) {
    try {
        const row = _gsGet.get(jid);
        if (row) {
            const parsed = parseGroupState(row);
            return { botName: row.bot_name || undefined, menuImage: row.menu_image || undefined, prefix: row.prefix || undefined, stickerPack: row.sticker_pack || undefined, stickerAuthor: row.sticker_author || undefined, theme: row.theme || undefined, ...parsed, ...(parsed.extra || {}) };
        }
    } catch (_) {}
    return { antilink: true };
}

function setGroupData(jid, data) {
    const cur = ensureGroupState(jid);
    const curParsed = parseGroupState(cur);
    const merged = { ...curParsed };
    const EXTRA_KEYS = new Set(['regras', 'welcomeOn', 'welcomeMsg', 'goodbyeOn', 'goodbyeMsg', 'promoteOn', 'promoteMsg', 'demoteOn', 'demoteMsg', 'groupChangeOn', 'groupChangeMsg']);
    merged.extra = { ...(curParsed.extra || {}) };
    let botName = cur.bot_name;
    let menuImage = cur.menu_image;
    let prefix = cur.prefix ?? null;
    let stickerPack = cur.sticker_pack ?? null;
    let stickerAuthor = cur.sticker_author ?? null;
    let theme = cur.theme ?? null;
    for (const [k, v] of Object.entries(data)) {
        if (k === 'botName') botName = v;
        else if (k === 'menuImage') menuImage = v;
        else if (k === 'prefix') prefix = v == null ? null : String(v).slice(0, 3) || null;
        else if (k === 'stickerPack') stickerPack = v == null ? null : String(v).slice(0, 30) || null;
        else if (k === 'stickerAuthor') stickerAuthor = v == null ? null : String(v).slice(0, 30) || null;
        else if (k === 'theme') theme = v == null ? null : String(v).trim().toLowerCase().slice(0, 20) || null;
        else if (EXTRA_KEYS.has(k)) {
            if (v === null || v === undefined) delete merged.extra[k];
            else merged.extra[k] = v;
        }
        else merged[k] = v;
    }
    let mutedObj = merged.muted;
    if (Array.isArray(mutedObj)) {
        const converted = {};
        const ts = Date.now();
        for (const p of mutedObj) if (p) converted[p] = ts;
        mutedObj = converted;
    } else if (!mutedObj || typeof mutedObj !== 'object') { mutedObj = {}; }
    writeGroupState(jid, {
        muted: JSON.stringify(mutedObj),
        warnings: JSON.stringify(merged.warnings || {}),
        antilink: merged.antilink ? 1 : 0,
        activity: JSON.stringify(merged.activity || {}),
        bot_name: botName || null,
        menu_image: menuImage || null,
        prefix,
        sticker_pack: stickerPack,
        sticker_author: stickerAuthor,
        theme,
        extra: JSON.stringify(merged.extra || {})
    });
}

// ============================================================
// Theme helpers (por grupo)
// ============================================================
function getThemeForJid(jid) {
    if (jid && jid.endsWith('@g.us')) {
        try {
            const gd = getGroupData(jid);
            const t = String(gd.theme || 'default').trim().toLowerCase();
            if (t && t !== 'default') return t;
        } catch (_) {}
    }
    return 'default';
}

function setGroupTheme(jid, themeId) {
    if (!jid || !jid.endsWith('@g.us')) return false;
    const t = String(themeId || '').trim().toLowerCase().slice(0, 20) || null;
    if (!t) return false;
    setGroupData(jid, { theme: t === 'default' ? null : t });
    return true;
}

function clearGroupTheme(jid) {
    if (!jid || !jid.endsWith('@g.us')) return false;
    setGroupData(jid, { theme: null });
    return true;
}

function _getGroupField(jid, field, cfgKey, defaultVal) {
    if (jid && jid.endsWith('@g.us')) {
        try { const gd = getGroupData(jid); if (gd[field]) return String(gd[field]); } catch (_) {}
    }
    try { return String(readConfig()[cfgKey] || defaultVal); } catch (_) { return defaultVal; }
}

// ============================================================
// Prefix helpers (por grupo)
// ============================================================
function getPrefixForJid(jid) { return _getGroupField(jid, 'prefix', 'prefix', DEFAULT_CONFIG.prefix); }

function setGroupPrefix(jid, prefixChar) {
    if (!jid || !jid.endsWith('@g.us')) return false;
    const p = String(prefixChar || '').trim()[0] || null;
    if (!p) return false;
    setGroupData(jid, { prefix: p });
    return true;
}

function clearGroupPrefix(jid) {
    if (!jid || !jid.endsWith('@g.us')) return false;
    setGroupData(jid, { prefix: null });
    return true;
}

// ============================================================
// Sticker pack/author helpers (por grupo)
// ============================================================
function getStickerPackForJid(jid) { return _getGroupField(jid, 'stickerPack', 'stickerPack', DEFAULT_CONFIG.stickerPack); }

function getStickerAuthorForJid(jid) { return _getGroupField(jid, 'stickerAuthor', 'stickerAuthor', DEFAULT_CONFIG.stickerAuthor); }

function setStickerPackForJid(jid, pack, author) {
    if (!jid || !jid.endsWith('@g.us')) return false;
    const p = pack != null ? String(pack).trim().slice(0, 30) : null;
    const a = author != null ? String(author).trim().slice(0, 30) : null;
    if (!p && !a) return false;
    const data = {};
    if (p) data.stickerPack = p;
    if (a) data.stickerAuthor = a;
    setGroupData(jid, data);
    return true;
}

function clearStickerPackForJid(jid) {
    if (!jid || !jid.endsWith('@g.us')) return false;
    setGroupData(jid, { stickerPack: null, stickerAuthor: null });
    return true;
}

async function saveGroupMenuImage(jid, buffer) {
    if (!buffer || buffer.length > 5 * 1024 * 1024) throw new Error('Imagem muito grande (max 5MB)');
    const hash = crypto.createHash('md5').update(jid).digest('hex');
    const fileName = `menu_${hash}.png`;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, fileName);
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    if ((meta.width || 0) > 3000 || (meta.height || 0) > 3000) throw new Error('Imagem muito grande (max 3000x3000)');
    await sharp(buffer, { failOn: 'none' }).rotate().resize({ width: 512, height: 512, fit: 'fill', kernel: sharp.kernel.lanczos3 }).png().toFile(filePath);
    const relativePath = `uploads/${fileName}`;
    setGroupData(jid, { menuImage: relativePath });
    return filePath;
}

// ============================================================
// Activity (bufferizado em memória, flush periódico)
// ============================================================
const _activityBuffer = new Map();
const ACTIVITY_FLUSH_INTERVAL = 30000;

function _flushActivity() {
    if (!_activityBuffer.size) return;
    const entries = Array.from(_activityBuffer.entries());
    const tx = db.transaction((rows) => {
        for (const [jid, members] of rows) {
            const row = ensureGroupState(jid);
            const act = safeJson(row.activity, {});
            if (!act[jid]) act[jid] = {};
            for (const [sender, info] of members) {
                if (!act[jid][sender]) act[jid][sender] = { name: info.name, count: 0 };
                else if (info.name && !['usuario', 'usuário'].includes(String(info.name).trim().toLowerCase())) {
                    act[jid][sender].name = info.name;
                }
                act[jid][sender].count += info.count;
            }
            writeGroupState(jid, { activity: JSON.stringify(act) });
        }
    });
    try {
        tx(entries);
        _activityBuffer.clear();
    } catch (e) {
        console.error('❌ [activity] flush falhou, mantendo buffer:', e.message);
    }
}

let _activityFlushTimer = null;
function _scheduleActivityFlush() {
    if (_activityFlushTimer) return;
    _activityFlushTimer = setTimeout(() => {
        _activityFlushTimer = null;
        _flushActivity();
    }, ACTIVITY_FLUSH_INTERVAL);
}

function updateMemberActivity(jid, sender, senderName) {
    if (!jid || !sender) return;
    // Canônico: "5511..:12@s.whatsapp.net" e "5511..@s.whatsapp.net" viram
    // a mesma chave (antes o mesmo usuário gerava 2 linhas no rank).
    // LID→PN é resolvido no message.js (participantPn) antes de chegar aqui.
    let canon = sender;
    try { canon = normalizeJid(sender); } catch (_) {}
    if (!_activityBuffer.has(jid)) _activityBuffer.set(jid, new Map());
    const members = _activityBuffer.get(jid);
    const cleanName = String(senderName || 'Usuário').trim().slice(0, 30) || 'Usuário';
    const isGeneric = ['usuario', 'usuário'].includes(cleanName.toLowerCase());
    if (!members.has(canon)) {
        members.set(canon, { name: cleanName, count: 0 });
    } else if (!isGeneric) {
        // mantém o nome sempre atualizado (apelidos novos refletem no rank)
        members.get(canon).name = cleanName;
    }
    members.get(canon).count += 1;
    _scheduleActivityFlush();
}

function getTopMember(jid) {
    // Flush antes de ler para ter dados consistentes
    if (_activityFlushTimer) { clearTimeout(_activityFlushTimer); _activityFlushTimer = null; }
    _flushActivity();
    try {
        const row = _gsGet.get(jid);
        if (!row) return 'Nenhum registro hoje';
        const act = safeJson(row.activity, {});
        const groupActivity = act[jid];
        if (!groupActivity) return 'Nenhum registro hoje';
        let topSender = null, maxCount = -1;
        for (const sender in groupActivity) {
            if (groupActivity[sender].count > maxCount) { maxCount = groupActivity[sender].count; topSender = groupActivity[sender].name; }
        }
        return topSender || 'Nenhum registro hoje';
    } catch (_) { return 'Nenhum registro hoje'; }
}

// ============================================================
// Rank mensal — Top 10 ativos (reseta dia 1)
// ============================================================
function _getCurrentMonthKey() {
    // Usa America/Sao_Paulo para bater com dia 1 BRT
    try {
        const d = new Date();
        const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(d);
        const y = parts.find(p => p.type === 'year')?.value;
        const m = parts.find(p => p.type === 'month')?.value;
        if (y && m) return `${y}-${m}`;
    } catch (_) {}
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _getMonthLabelBr(monthKey) {
    // monthKey "YYYY-MM" -> "setembro de 2026"
    try {
        const [y, m] = String(monthKey).split('-').map(Number);
        const d = new Date(y, (m || 1) - 1, 1);
        return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    } catch (_) { return String(monthKey); }
}

function _isFirstDayBrt() {
    try {
        const d = new Date();
        const day = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit' }).format(d);
        return Number(day) === 1;
    } catch (_) { return new Date().getDate() === 1; }
}

function getMonthlyRank(jid, limit = 10) {
    if (!jid) return [];
    if (_activityFlushTimer) { clearTimeout(_activityFlushTimer); _activityFlushTimer = null; }
    _flushActivity();
    try {
        const row = _gsGet.get(jid);
        if (!row) return [];
        const act = safeJson(row.activity, {});
        const groupActivity = act[jid];
        if (!groupActivity || typeof groupActivity !== 'object') return [];
        // merge buffer pendente (caso flush acima nao pegou devido a timing)
        const buf = _activityBuffer.get(jid);
        const merged = { ...groupActivity };
        if (buf) {
            for (const [sender, info] of buf.entries()) {
                let key = sender;
                try { key = normalizeJid(sender); } catch (_) {}
                if (!merged[key]) merged[key] = { name: info.name, count: 0 };
                merged[key] = { name: merged[key].name || info.name, count: (Number(merged[key].count) || 0) + (Number(info.count) || 0) };
            }
        }
        // Colapsa variantes LID/PN do mesmo número (dígitos iguais = mesma
        // pessoa) para o rank não mostrar 2 linhas do mesmo usuário.
        const byDigits = new Map();
        for (const [senderJid, v] of Object.entries(merged)) {
            const digits = String(senderJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
            const dkey = digits.length >= 8 ? `d:${digits.slice(-11)}` : `j:${senderJid}`;
            const cur = byDigits.get(dkey);
            const cnt = Number(v.count) || 0;
            const nm = String(v.name || '').trim();
            if (!cur) byDigits.set(dkey, { jid: senderJid, name: nm || 'Usuário', count: cnt });
            else {
                cur.count += cnt;
                if (nm && /^(usuário|usuario)?$/i.test(cur.name) && !/^(usuário|usuario)?$/i.test(nm)) cur.name = nm;
            }
        }
        const list = Array.from(byDigits.values()).map(x => ({
            jid: x.jid,
            name: String(x.name || 'Usuário').trim().slice(0, 30) || 'Usuário',
            count: Number(x.count) || 0
        })).filter(x => x.count > 0);
        list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
        const lim = Math.max(1, Math.min(50, Number(limit) || 10));
        return list.slice(0, lim);
    } catch (_) { return []; }
}

function clearMonthlyRank(jid) {
    if (!jid) return false;
    try {
        if (_activityFlushTimer) { clearTimeout(_activityFlushTimer); _activityFlushTimer = null; }
        _flushActivity();
        const row = _gsGet.get(jid);
        if (!row) return false;
        const act = safeJson(row.activity, {});
        if (act[jid]) {
            delete act[jid];
            writeGroupState(jid, { activity: JSON.stringify(act) });
        }
        try { _activityBuffer.delete(jid); } catch (_) {}
        return true;
    } catch (_) { return false; }
}

// ============================================================
// Rank GLOBAL mensal — agrega todos os grupos (top conversadores + top grupos)
// ============================================================
function _collectAllGroupActivities() {
    if (_activityFlushTimer) { clearTimeout(_activityFlushTimer); _activityFlushTimer = null; }
    _flushActivity();
    let rows = [];
    try { rows = _gsAll.all(); } catch (_) { rows = []; }
    const perGroup = []; // [{ jid, members: {senderJid: {name,count}} }]
    for (const r of rows) {
        const gjid = r.jid;
        if (!gjid || !String(gjid).endsWith('@g.us')) continue;
        let act = {};
        try { act = safeJson(r.activity, {}); } catch (_) { act = {}; }
        const g = act[gjid] || {};
        const members = {};
        for (const [senderJid, v] of Object.entries(g)) {
            const cnt = Number(v?.count) || 0;
            if (cnt <= 0) continue;
            members[senderJid] = { name: String(v?.name || 'Usuário').trim().slice(0, 30) || 'Usuário', count: cnt };
        }
        // merge buffer pendente (caso algo tenha entrado entre flush e leitura)
        try {
            const buf = _activityBuffer.get(gjid);
            if (buf) {
                for (const [sender, info] of buf.entries()) {
                    let key = sender;
                    try { key = normalizeJid(sender); } catch (_) {}
                    if (!members[key]) members[key] = { name: info.name, count: 0 };
                    members[key] = { name: members[key].name || info.name, count: (Number(members[key].count) || 0) + (Number(info.count) || 0) };
                }
            }
        } catch (_) {}
        const total = Object.values(members).reduce((s, v) => s + (Number(v.count) || 0), 0);
        if (total > 0) perGroup.push({ jid: gjid, members, total });
    }
    return perGroup;
}

function getGlobalMonthlyRank(limit = 10) {
    try {
        const perGroup = _collectAllGroupActivities();
        const byDigits = new Map();
        for (const g of perGroup) {
            for (const [senderJid, v] of Object.entries(g.members)) {
                const digits = String(senderJid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
                const dkey = digits.length >= 8 ? `d:${digits.slice(-11)}` : `j:${senderJid}`;
                const cnt = Number(v.count) || 0;
                const nm = String(v.name || '').trim();
                const cur = byDigits.get(dkey);
                if (!cur) {
                    byDigits.set(dkey, { jid: senderJid, name: nm || 'Usuário', count: cnt, groups: new Set([g.jid]) });
                } else {
                    cur.count += cnt;
                    cur.groups.add(g.jid);
                    if (nm && /^(usuário|usuario)?$/i.test(cur.name) && !/^(usuário|usuario)?$/i.test(nm)) cur.name = nm;
                }
            }
        }
        const list = Array.from(byDigits.values()).map(x => ({
            jid: x.jid,
            name: String(x.name || 'Usuário').trim().slice(0, 30) || 'Usuário',
            count: Number(x.count) || 0,
            groups: x.groups ? x.groups.size : 0
        })).filter(x => x.count > 0);
        list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
        const lim = Math.max(1, Math.min(50, Number(limit) || 10));
        return list.slice(0, lim);
    } catch (_) { return []; }
}

function getTopGroupsByActivity(limit = 3) {
    try {
        const perGroup = _collectAllGroupActivities();
        perGroup.sort((a, b) => b.total - a.total);
        const lim = Math.max(1, Math.min(20, Number(limit) || 3));
        return perGroup.slice(0, lim).map(g => ({
            jid: g.jid,
            total: g.total,
            members: Object.keys(g.members).length
        }));
    } catch (_) { return []; }
}

// Salva foto do mês que está encerrando antes de zerar — a contagem nunca se perde,
// mesmo após o reset do dia 1º é possível consultar o histórico.
function snapshotMonthlyRanks(monthKey) {
    if (!monthKey) return 0;
    try {
        const rows = _gsAll.all();
        const ins = db.prepare('INSERT OR REPLACE INTO rank_monthly_history (jid, month, total, data, created_at) VALUES (?, ?, ?, ?, ?)');
        let saved = 0;
        const tx = db.transaction((rs) => {
            for (const r of rs) {
                const act = safeJson(r.activity, {});
                const g = act[r.jid] || {};
                let total = 0;
                for (const k of Object.keys(g)) total += Number(g[k]?.count) || 0;
                if (total > 0) { ins.run(r.jid, monthKey, total, JSON.stringify(g), Date.now()); saved++; }
            }
        });
        tx(rows);
        if (saved > 0) console.log(`📸 [rank mensal] histórico de ${monthKey} salvo (${saved} grupo(s))`);
        return saved;
    } catch (e) {
        console.error('❌ Falha ao salvar histórico do rank:', e.message);
        return 0;
    }
}

function getRankHistory(jid, monthKey) {
    if (!jid || !monthKey) return null;
    try {
        const row = db.prepare('SELECT total, data, created_at FROM rank_monthly_history WHERE jid = ? AND month = ?').get(jid, monthKey);
        if (!row) return null;
        return { total: row.total, data: safeJson(row.data, {}), createdAt: row.created_at };
    } catch (_) { return null; }
}

function clearAllMonthlyRanks() {
    try {
        if (_activityFlushTimer) { clearTimeout(_activityFlushTimer); _activityFlushTimer = null; }
        _flushActivity();
        _activityBuffer.clear();
        const rows = _gsAll.all();
        const tx = db.transaction((rs) => {
            for (const r of rs) writeGroupState(r.jid, { activity: '{}' });
        });
        tx(rows);
        return rows.length;
    } catch (e) {
        console.error('❌ Falha ao resetar rank mensal:', e.message);
        return 0;
    }
}

function checkMonthlyReset({ force = false } = {}) {
    try {
        const currentKey = _getCurrentMonthKey();
        const lastKey = (() => { try { const r = _statsGet.get('_activityMonth'); return r ? String(r.value) : null; } catch { return null; } })();
        // Se nunca teve chave, inicializa sem resetar
        if (!lastKey) {
            _statsSet.run('_activityMonth', currentKey);
            // compat: mantém _activityDate antigo mas migra
            try { _statsSet.run('_activityDate', currentKey); } catch (_) {}
            return { reset: false, reason: 'init', currentKey };
        }
        if (lastKey === currentKey && !force) return { reset: false, reason: 'same-month', currentKey };
        // Chave mudou => já estamos no mês novo (a chave vira exatamente no dia 1º).
        // Reseta imediatamente, mesmo que o bot tenha perdido a janela do dia 1º —
        // reset atrasado é melhor que acumular 2 meses. Compara a chave YYYY-MM
        // completa para não travar na virada de ano p/ o mesmo mês (2025-09 -> 2026-09).
        // Snapshot do mês que encerrou (lastKey) ANTES de zerar — histórico preservado.
        try { snapshotMonthlyRanks(lastKey); } catch (_) {}
        const n = clearAllMonthlyRanks();
        _statsSet.run('_activityMonth', currentKey);
        try { _statsSet.run('_activityDate', currentKey); } catch (_) {}
        console.log(`📅 [rank mensal] Resetado para ${currentKey} (${_getMonthLabelBr(currentKey)}) — ${n} grupo(s) zerados`);
        return { reset: true, currentKey, count: n };
    } catch (e) {
        console.error('❌ [rank mensal] checkMonthlyReset falhou:', e.message);
        return { reset: false, error: e.message };
    }
}

function getCachedParticipantName(jid, participantJid) {
    if (!jid || !participantJid) return null;
    try {
        const buf = _activityBuffer.get(jid);
        if (buf && buf.has(participantJid)) {
            const v = buf.get(participantJid);
            if (v && v.name && !['usuario', 'usuário'].includes(String(v.name).trim().toLowerCase())) return v.name;
        }
        const row = _gsGet.get(jid);
        if (row) {
            const act = safeJson(row.activity, {});
            const ga = act[jid];
            if (ga && ga[participantJid] && ga[participantJid].name) {
                const n = ga[participantJid].name;
                if (n && !['usuario', 'usuário'].includes(String(n).trim().toLowerCase())) return n;
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Obtém o nome do participante de grupo de forma performática e sem rate-limit.
 * Ordem: pushName válido -> cache activity -> groupMetadataCached (5-15min TTL) -> 'Usuário'
 * Nunca expõe número de telefone em texto.
 */
async function getGroupParticipantName(sock, groupId, senderId, pushName) {
    const isGeneric = (n) => !n || ['usuario', 'usuário'].includes(String(n).trim().toLowerCase());
    if (pushName && !isGeneric(pushName)) return String(pushName).trim();
    if (groupId && senderId && groupId.endsWith('@g.us')) {
        const cached = getCachedParticipantName(groupId, senderId);
        if (cached && !isGeneric(cached)) return cached;
        try {
            const meta = await groupMetadataCached(sock, groupId);
            const p = meta?.participants?.find(x => (x.id || x.jid) === senderId);
            const found = p?.notify || p?.name || p?.verifiedName || null;
            if (found && !isGeneric(found)) return String(found).trim();
        } catch (_) {}
    }
    if (pushName && !isGeneric(pushName)) return String(pushName).trim();
    return 'Usuário';
}

// ============================================================
// Message Buffer
// ============================================================
const _msgInsert = db.prepare('INSERT INTO messages (jid, push_name, text, time) VALUES (?, ?, ?, ?)');
const _msgTrimByJid = db.prepare('DELETE FROM messages WHERE jid = ? AND id NOT IN (SELECT id FROM messages WHERE jid = ? ORDER BY time DESC LIMIT ?)');
const _msgSelectByJid = db.prepare('SELECT push_name as pushName, text, time FROM messages WHERE jid = ? ORDER BY time DESC LIMIT ?');

let _msgBuffer = [];
let _msgBufferByJid = new Map();
let _msgFlushTimer = null;
const MSG_FLUSH_INTERVAL = 5000;
const MSG_FLUSH_BATCH = 20;

function flushMessagesSync() {
    if (_msgFlushTimer) { clearTimeout(_msgFlushTimer); _msgFlushTimer = null; }
    if (_msgBuffer.length === 0) return;
    const toInsert = _msgBuffer.slice();
    const tmpByJid = new Map(_msgBufferByJid);
    const limitsByJid = new Map();
    for (const r of toInsert) { if (!limitsByJid.has(r.jid)) limitsByJid.set(r.jid, r.limit); }
    try {
        db.transaction((rows) => {
            for (const r of rows) _msgInsert.run(r.jid, r.pushName, r.text, r.time);
            for (const [jid, limit] of limitsByJid) _msgTrimByJid.run(jid, jid, limit);
        })(toInsert);
        _msgBuffer = _msgBuffer.slice(toInsert.length);
        for (const [jid] of tmpByJid) {
            const remain = _msgBuffer.filter(r => r.jid === jid).length;
            if (remain === 0) _msgBufferByJid.delete(jid);
            else _msgBufferByJid.set(jid, remain);
        }
        try { db.pragma('incremental_vacuum(200)'); } catch (_) {}
    } catch (e) {
        console.error('❌ Falha ao gravar messages:', e.message);
    }
}

function scheduleMsgFlush() {
    if (_msgFlushTimer) return;
    _msgFlushTimer = setTimeout(() => { _msgFlushTimer = null; flushMessagesSync(); }, MSG_FLUSH_INTERVAL);
}

let _cachedSummaryLimit = null;
function _getSummaryLimit() {
    if (_cachedSummaryLimit !== null) return _cachedSummaryLimit;
    try { _cachedSummaryLimit = Number(readConfig().summaryLimit) || 20; } catch (_) { _cachedSummaryLimit = 20; }
    return _cachedSummaryLimit;
}
function saveMessage(jid, pushName, text) {
    if (!text) return;
    const limit = _getSummaryLimit();
    _msgBuffer.push({ jid, pushName: pushName || '', text: String(text), time: Date.now(), limit });
    const cnt = (_msgBufferByJid.get(jid) || 0) + 1;
    _msgBufferByJid.set(jid, cnt);
    if (cnt >= limit || _msgBuffer.length >= MSG_FLUSH_BATCH) { flushMessagesSync(); return; }
    scheduleMsgFlush();
}

function getChatHistory(jid, limit = 20) {
    flushMessagesSync();
    try { const rows = _msgSelectByJid.all(jid, limit); return rows.reverse(); } catch (e) { return []; }
}

function clearChatHistory(jid) {
    flushMessagesSync();
    try { db.prepare('DELETE FROM messages WHERE jid = ?').run(jid); } catch (e) { console.error('❌ Falha ao limpar histórico:', e.message); }
    _msgBufferByJid.delete(jid);
}

// ============================================================
// Group analytics — msgs por hora + moderação (base do !infogrupo)
// ============================================================
function _analyticsDayHour(ts = Date.now()) {
    try {
        const parts = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
        }).formatToParts(new Date(ts));
        const get = (t) => parts.find(p => p.type === t)?.value || '00';
        const day = `${get('year')}-${get('month')}-${get('day')}`;
        const hour = Math.max(0, Math.min(23, Number(get('hour')) || 0));
        return { day, hour };
    } catch (_) {
        const d = new Date(ts);
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return { day, hour: d.getHours() };
    }
}

function recordGroupMessage(jid, ts = Date.now()) {
    if (!jid || !jid.endsWith('@g.us')) return;
    try {
        const { day, hour } = _analyticsDayHour(ts);
        db.prepare(`INSERT INTO group_msg_stats (jid, day, hour, count) VALUES (?, ?, ?, 1)
            ON CONFLICT(jid, day, hour) DO UPDATE SET count = count + 1`).run(jid, day, hour);
    } catch (_) {}
}

const MODLOG_KINDS = new Set(['join', 'leave', 'ban', 'warn', 'spam']);
function recordModEvent(jid, kind, ts = Date.now()) {
    if (!jid || !jid.endsWith('@g.us')) return;
    if (!MODLOG_KINDS.has(String(kind))) return;
    try {
        db.prepare('INSERT INTO group_modlog (jid, kind, timestamp) VALUES (?, ?, ?)').run(jid, String(kind), Number(ts) || Date.now());
        // poda: mantém 90 dias por grupo
        try { db.prepare('DELETE FROM group_modlog WHERE jid = ? AND timestamp < ?').run(jid, Date.now() - 90 * 86400 * 1000); } catch (_) {}
    } catch (_) {}
}

function getGroupAnalytics(jid, days = 7) {
    const out = {
        total: 0, avgDay: 0, avgHour: 0, perHour: new Array(24).fill(0),
        perDay: {}, peakLabel: null, joins: 0, leaves: 0, bans: 0, warns: 0, spams: 0,
        hasData: false, days
    };
    if (!jid) return out;
    const d = Math.max(1, Math.min(30, Number(days) || 7));
    const since = Date.now() - d * 86400 * 1000;
    try {
        const rows = db.prepare('SELECT hour, SUM(count) as c FROM group_msg_stats WHERE jid = ? AND day >= date(?, ?) GROUP BY hour').all(jid, 'now', `-${d} days`);
        // fallback: se formato de day (dd/mm/yyyy invertido) não casar com date(), busca por timestamp aproximado via últimos N dias distintos
        let total = 0;
        if (rows && rows.length) {
            for (const r of rows) {
                const h = Number(r.hour);
                const c = Number(r.c) || 0;
                if (h >= 0 && h < 24) out.perHour[h] = c;
                total += c;
            }
        } else {
            // tenta soma direta dos últimos d dias distintos registrados
            try {
                const dayRows = db.prepare('SELECT day, hour, count FROM group_msg_stats WHERE jid = ? ORDER BY day DESC LIMIT ?').all(jid, d * 24);
                for (const r of dayRows) {
                    const h = Number(r.hour);
                    const c = Number(r.count) || 0;
                    if (h >= 0 && h < 24) out.perHour[h] += c;
                    total += c;
                    out.perDay[r.day] = (out.perDay[r.day] || 0) + c;
                }
            } catch (_) {}
        }
        out.total = total;
        if (total > 0) {
            out.hasData = true;
            out.avgDay = total / d;
            out.avgHour = total / (d * 24);
            // pico: melhor janela de 2h consecutivas
            let best = -1, bestH = -1;
            for (let h = 0; h < 24; h++) {
                const s = out.perHour[h] + out.perHour[(h + 1) % 24];
                if (s > best) { best = s; bestH = h; }
            }
            if (best > 0 && bestH >= 0) {
                const pad = (n) => String(n).padStart(2, '0');
                out.peakLabel = `${pad(bestH)}:00h - ${pad((bestH + 2) % 24)}:00h`;
            }
        }
    } catch (_) {}
    try {
        const counts = db.prepare('SELECT kind, COUNT(*) as c FROM group_modlog WHERE jid = ? AND timestamp >= ? GROUP BY kind').all(jid, since);
        for (const r of counts || []) {
            const c = Number(r.c) || 0;
            if (r.kind === 'join') out.joins = c;
            else if (r.kind === 'leave') out.leaves = c;
            else if (r.kind === 'ban') out.bans = c;
            else if (r.kind === 'warn') out.warns = c;
            else if (r.kind === 'spam') out.spams = c;
        }
    } catch (_) {}
    return out;
}

// ============================================================
// Fichas de pessoas (!ficha) — escopo global
// ============================================================
function _pessoaStmts() {
    return {
        get: db.prepare('SELECT * FROM pessoas WHERE nome_norm = ?'),
        search: db.prepare("SELECT * FROM pessoas WHERE nome LIKE '%' || ? || '%' ESCAPE '\\' ORDER BY nome ASC LIMIT ?"),
        list: db.prepare('SELECT * FROM pessoas ORDER BY nome ASC LIMIT ? OFFSET ?'),
        count: db.prepare('SELECT COUNT(*) as c FROM pessoas'),
        byMonth: db.prepare("SELECT * FROM pessoas WHERE nascimento IS NOT NULL AND substr(nascimento, 6, 2) = ? ORDER BY substr(nascimento, 9, 2) ASC"),
        byCity: db.prepare('SELECT * FROM pessoas WHERE cidade LIKE ? ESCAPE \'\\\' ORDER BY nome ASC'),
        cityGroups: db.prepare('SELECT cidade, COUNT(*) as total FROM pessoas WHERE cidade IS NOT NULL AND cidade != \'\' GROUP BY cidade ORDER BY total DESC, cidade ASC'),
        random: db.prepare('SELECT * FROM pessoas ORDER BY RANDOM() LIMIT 1'),
        upsert: db.prepare(`INSERT INTO pessoas (nome, nome_norm, nascimento, cidade, descricao, status, hobby, pix, instagram, linkedin, foto_path, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(nome_norm) DO UPDATE SET nome=excluded.nome, nascimento=excluded.nascimento, cidade=excluded.cidade, descricao=excluded.descricao, status=excluded.status, hobby=excluded.hobby, pix=excluded.pix, instagram=excluded.instagram, linkedin=excluded.linkedin, foto_path=COALESCE(excluded.foto_path, pessoas.foto_path), updated_at=excluded.updated_at`),
        update: db.prepare('UPDATE pessoas SET nome = COALESCE(?, nome), nascimento = COALESCE(?, nascimento), cidade = COALESCE(?, cidade), descricao = COALESCE(?, descricao), status = COALESCE(?, status), hobby = COALESCE(?, hobby), pix = COALESCE(?, pix), instagram = COALESCE(?, instagram), linkedin = COALESCE(?, linkedin), foto_path = COALESCE(?, foto_path), updated_at = ? WHERE nome_norm = ?'),
        del: db.prepare('DELETE FROM pessoas WHERE nome_norm = ?'),
        clearFoto: db.prepare('UPDATE pessoas SET foto_path = NULL, updated_at = ? WHERE nome_norm = ?')
    };
}

function _normPessoa(nome) {
    try { return require('../services/ficha').normalizeNome(nome); }
    catch (_) { return String(nome || '').trim().toLowerCase().slice(0, 40); }
}

function _escapeLike(s) {
    return String(s || '').replace(/[\\%_]/g, (c) => '\\' + c);
}

function upsertPessoa(data = {}) {
    const nome = String(data.nome || '').trim().slice(0, 40);
    if (nome.length < 2) return { ok: false, error: 'Nome muito curto (mín. 2 letras).' };
    try {
        const check = require('../services/ficha').isValidPessoaNome(nome);
        if (check && !check.ok) return { ok: false, error: check.reason };
    } catch (_) {}
    const nomeNorm = _normPessoa(nome);
    if (!nomeNorm) return { ok: false, error: 'Nome inválido.' };
    try {
        const s = _pessoaStmts();
        const prev = s.get.get(nomeNorm) || null;
        const now = Date.now();
        const pick = (k) => (data[k] !== undefined ? data[k] : (prev ? prev[k] : null));
        s.upsert.run(nome, nomeNorm, pick('nascimento'), pick('cidade'), pick('descricao'), pick('status'), pick('hobby'), pick('pix'), pick('instagram'), pick('linkedin'), data.foto_path !== undefined ? data.foto_path : (prev ? prev.foto_path : null), data.created_by || (prev ? prev.created_by : null), prev ? prev.created_at : now, now);
        return { ok: true, created: !prev };
    } catch (e) { return { ok: false, error: e.message }; }
}

function getPessoa(nome) {
    const norm = _normPessoa(nome);
    if (!norm) return null;
    try { return _pessoaStmts().get.get(norm) || null; } catch (_) { return null; }
}

function searchPessoas(term, limit = 5) {
    const t = String(term || '').trim().slice(0, 40);
    if (!t) return [];
    try { return _pessoaStmts().search.all(_escapeLike(t), Math.max(1, Math.min(10, Number(limit) || 5))) || []; } catch (_) { return []; }
}

function listPessoas(limit = 10, offset = 0) {
    try {
        const lim = Math.max(1, Math.min(50, Number(limit) || 10));
        const off = Math.max(0, Number(offset) || 0);
        return _pessoaStmts().list.all(lim, off) || [];
    } catch (_) { return []; }
}

function countPessoas() {
    try { const r = _pessoaStmts().count.get(); return r ? r.c : 0; } catch (_) { return 0; }
}

function deletePessoa(nome) {
    const norm = _normPessoa(nome);
    if (!norm) return false;
    try { return _pessoaStmts().del.run(norm).changes > 0; } catch (_) { return false; }
}

function updatePessoa(nome, patch = {}) {
    const norm = _normPessoa(nome);
    if (!norm) return { ok: false, error: 'Nome inválido.' };
    try {
        const s = _pessoaStmts();
        const prev = s.get.get(norm);
        if (!prev) return { ok: false, error: 'Ficha não encontrada.' };
        const novoNome = patch.nome !== undefined ? String(patch.nome).trim().slice(0, 40) : null;
        if (novoNome !== null && novoNome.length < 2) return { ok: false, error: 'Novo nome muito curto.' };
        if (novoNome) {
            try {
                const check = require('../services/ficha').isValidPessoaNome(novoNome);
                if (check && !check.ok) return { ok: false, error: check.reason };
            } catch (_) {}
        }
        const r = s.update.run(novoNome || null, patch.nascimento !== undefined ? patch.nascimento : null, patch.cidade !== undefined ? patch.cidade : null, patch.descricao !== undefined ? patch.descricao : null, patch.status !== undefined ? patch.status : null, patch.hobby !== undefined ? patch.hobby : null, patch.pix !== undefined ? patch.pix : null, patch.instagram !== undefined ? patch.instagram : null, patch.linkedin !== undefined ? patch.linkedin : null, patch.foto_path !== undefined ? patch.foto_path : null, Date.now(), norm);
        if (novoNome) {
            try {
                const newNorm = _normPessoa(novoNome);
                if (newNorm && newNorm !== norm) db.prepare('UPDATE pessoas SET nome_norm = ? WHERE nome_norm = ?').run(newNorm, norm);
            } catch (_) {}
        }
        return { ok: r.changes > 0 };
    } catch (e) { return { ok: false, error: e.message }; }
}

function clearPessoaFoto(nome) {
    const norm = _normPessoa(nome);
    if (!norm) return false;
    try { return _pessoaStmts().clearFoto.run(Date.now(), norm).changes > 0; } catch (_) { return false; }
}

function aniversariantes(mes) {
    const mm = String(mes).padStart(2, '0');
    if (!/^(0[1-9]|1[0-2])$/.test(mm)) return [];
    try { return _pessoaStmts().byMonth.all(mm) || []; } catch (_) { return []; }
}

function pessoasPorCidade(cidade) {
    const c = String(cidade || '').trim();
    if (!c) return [];
    try { return _pessoaStmts().byCity.all(`%${_escapeLike(c)}%`) || []; } catch (_) { return []; }
}

function agruparCidades() {
    try { return _pessoaStmts().cityGroups.all() || []; } catch (_) { return []; }
}

function pessoaAleatoria() {
    try { return _pessoaStmts().random.get() || null; } catch (_) { return null; }
}

async function saveFichaPhoto(buffer, nomeNorm) {
    if (!buffer || buffer.length > 5 * 1024 * 1024) throw new Error('Imagem muito grande (max 5MB)');
    const hash = crypto.createHash('md5').update(String(nomeNorm || Date.now())).digest('hex');
    const fileName = `ficha_${hash}.jpg`;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, fileName);
    await sharp(buffer, { failOn: 'none' }).rotate().resize({ width: 512, height: 512, fit: 'cover' }).jpeg({ quality: 85 }).toFile(filePath);
    return `uploads/${fileName}`;
}

// ============================================================
// Helper functions
// ============================================================
function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

function getBotName(from, config) {
    if (from.endsWith('@g.us')) {
        const groupData = getGroupData(from);
        if (groupData.botName) return groupData.botName;
    }
    return config.botName;
}

async function react(sock, m, emoji, lastBotResponse, GLOBAL_COOLDOWN) {
    try {
        const now = Date.now();
        if (now - lastBotResponse < GLOBAL_COOLDOWN) return lastBotResponse;
        await sock.sendMessage(m.key.remoteJid, { react: { text: emoji, key: m.key } });
        return now;
    } catch (error) { return lastBotResponse; }
}

async function reactStatus(sock, m, from, isOk, okEmoji, errEmoji, lastBotResponse, GLOBAL_COOLDOWN) {
    const emoji = isPartialActive(from) ? (isOk ? '🟡' : '⚠️') : (isOk ? (okEmoji || '✅') : (errEmoji || '❌'));
    return await react(sock, m, emoji, lastBotResponse, GLOBAL_COOLDOWN);
}

function normalizeJid(jid) {
    if (!jid) return jid;
    const [rawUser, domain] = jid.split('@');
    const [user] = rawUser.split(':');
    return `${user}@${domain || 's.whatsapp.net'}`;
}

function canAdminControl() {
    try { const cfg = readConfig(); return cfg && cfg.adminCanControl === true; } catch (_) { return false; }
}

let _cachedVersion = null;
function getVersion() {
    if (_cachedVersion) return _cachedVersion;
    try { _cachedVersion = execFileSync('git', ['log', '-1', '--format=%h %s'], { windowsHide: true }).toString().trim() || 'v1.0.0'; } catch (_) { _cachedVersion = 'v1.0.0'; }
    return _cachedVersion;
}

function flushNow() { flushMessagesSync(); if (_activityFlushTimer) { clearTimeout(_activityFlushTimer); _activityFlushTimer = null; } _flushActivity(); try { require('./supabaseSync').schedulePush(5000); } catch (_) {} }

// ============================================================
// Group metadata cache & admin helpers
// ============================================================
const _gmCache = new Map();
const _gmCacheTtlMs = 120000;

async function groupMetadataCached(sock, jid) {
    if (!sock || !jid) return { subject: 'Grupo', participants: [] };
    const cached = _gmCache.get(jid);
    const now = Date.now();
    if (cached && now - cached.ts < _gmCacheTtlMs) return cached.data;
    try {
        const data = await sock.groupMetadata(jid);
        _gmCache.set(jid, { ts: now, data });
        return data;
    } catch (e) { return { subject: 'Grupo', participants: [] }; }
}

function clearGroupMetadataCache(jid) {
    if (jid) _gmCache.delete(jid);
    else _gmCache.clear();
}

async function getAdmins(sock, jid) {
    try {
        const metadata = await groupMetadataCached(sock, jid);
        const parts = Array.isArray(metadata.participants) ? metadata.participants : [];
        return parts.filter(p => p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin).map(p => ({ id: p.id, jid: p.jid, lid: p.lid, name: p.name }));
    } catch (e) { return []; }
}

function isUserAdmin(sender, adminsRaw) {
    if (!adminsRaw || !Array.isArray(adminsRaw)) return false;
    const senderNorm = normalizeJid(sender);
    const senderUser = senderNorm.split('@')[0];
    return adminsRaw.some(p => {
        const candidates = [p.id, p.jid, p.lid].filter(Boolean).map(normalizeJid);
        return candidates.some(c => c.split('@')[0] === senderUser);
    });
}

function getBotJid(sock) {
    try { const raw = sock?.user?.id || sock?.user?.jid || ''; return normalizeJid(raw); } catch (_) { return ''; }
}

async function botIsAdmin(sock, jid) {
    const botRaw = getBotJid(sock);
    if (!botRaw) return false;
    const admins = await getAdmins(sock, jid);
    return isUserAdmin(botRaw, admins);
}

// ============================================================
// sendMessageSafe — wrapper com retry/backoff
// ============================================================
function _buildBackoffs(baseMs) {
    const base = Math.max(500, Number(baseMs) || 15000);
    return [base, Math.round(base * 2.5), Math.round(base * 5), Math.round(base * 10), Math.round(base * 20)];
}

function _isRateLimitError(err) {
    if (!err) return false;
    const data = err.data || err.output?.payload;
    if (data?.statusCode === 429) return true;
    const msg = String(err.message || err || '').toLowerCase();
    return msg.includes('rate-overlimit') || msg.includes('rate overlimit') || msg.includes('429');
}

function isConnectionClosedError(err) {
    if (!err) return false;
    const code = err?.output?.statusCode || err?.statusCode || err?.data?.statusCode;
    if (code === 428 || code === 515 || code === 502) return true;
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('connection closed') || msg.includes('precondition required') || msg.includes('connection timed out');
}

async function sendMessageSafe(sock, jid, payload, options = {}) {
    const { maxRetries = 3, baseDelayMs = 15000, onRetry } = options;
    const backoffs = _buildBackoffs(baseDelayMs);
    let attempt = 0;
    while (true) {
        try {
            const r = await sock.sendMessage(jid, payload, options.sendOptions || {});
            try { require('../services/watchdog').touchOutbound(); } catch (_) {}
            return r;
        } catch (err) {
            if (_isRateLimitError(err) && attempt < maxRetries) {
                const wait = backoffs[attempt] || backoffs[backoffs.length - 1];
                try { if (typeof onRetry === 'function') onRetry(attempt + 1, wait, err); } catch (_) {}
                await new Promise(r => setTimeout(r, wait));
                attempt++;
                continue;
            }
            throw err;
        }
    }
}

// ============================================================
// Initialization
// ============================================================
// === Migração: database.json → SQLite ===
migrateLegacyUnifiedDB();
migrateLegacyMessagesJson();
migrateLegacyActiveGroups();
migrateJsonToSqlite();

// Backup automático do banco (online, via SQLite backup API) — a cada 6h, mantém os
// últimos 4 arquivos (~1 dia). Pasta backups/ é local e ignorada pelo git.
const DB_BACKUP_KEEP = 4;
function backupDatabase() {
    try {
        flushNow();
        const dir = path.join(process.cwd(), 'backups');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        // Stamp com minutos: antes o 2º backup da mesma hora era pulado em
        // silêncio (if exists return). Minutos evitam a colisão.
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}h${pad(d.getMinutes())}`;
        const file = path.join(dir, `bot-${stamp}.db`);
        if (fs.existsSync(file)) {
            console.warn(`⚠️ [backup] arquivo ${path.basename(file)} já existe — pulando (sem aviso seria bug)`);
            return Promise.resolve(file);
        }
        return db.backup(file).then(() => {
            console.log(`💾 [backup] banco salvo em backups/bot-${stamp}.db`);
            try {
                const files = fs.readdirSync(dir).filter(f => /^bot-\d{4}-\d{2}-\d{2}(-\d{2}h(\d{2})?)?\.db$/.test(f)).sort();
                while (files.length > DB_BACKUP_KEEP) {
                    const old = files.shift();
                    try { fs.unlinkSync(path.join(dir, old)); } catch (_) {}
                }
            } catch (_) {}
            return file;
        }).catch((e) => {
            console.error('❌ [backup] falhou:', e.message);
            return null;
        });
    } catch (e) {
        console.error('❌ [backup] falhou:', e.message);
        return Promise.resolve(null);
    }
}

// Background init — não bloqueia startup
setTimeout(() => {
    // Rank mensal: reseta todo dia 1 (BRT)
    try { checkMonthlyReset(); } catch (e) { console.error('❌ Falha ao checar rank mensal:', e.message); }
    // Agenda verificação horária para garantir reset no dia 1 mesmo com bot ligado
    try {
        setInterval(() => { try { checkMonthlyReset(); } catch (_) {} }, 60 * 60 * 1000).unref();
    } catch (_) {}
    // Selfcheck do banco: prova escrita+leitura do group_state a cada boot.
    // Se a escrita quebrar (ex: nº de parâmetros), falha ALTO aqui em vez de
    // perder dados silenciosamente por semanas como aconteceu com o rank.
    try {
        const sj = '_selfcheck@g.us';
        const sAct = JSON.stringify({ [sj]: { 'self@s.whatsapp.net': { name: 'Selfcheck', count: 1 } } });
        writeGroupState(sj, { activity: sAct });
        const back = _gsGet.get(sj);
        const backCount = safeJson(back?.activity, {})?.[sj]?.['self@s.whatsapp.net']?.count;
        db.prepare('DELETE FROM group_state WHERE jid = ?').run(sj);
        if (backCount === 1) console.log('✅ [db] selfcheck escrita/leitura OK (group_state íntegro)');
        else console.error('❌ [db] SELFCHECK FALHOU: escreveu mas leu diferente — verifique o schema!');
    } catch (e) {
        console.error('❌ [db] SELFCHECK FALHOU:', e.message);
    }
    // Backup do banco a cada 6h (primeiro após 60s do boot)
    try {
        setTimeout(() => { backupDatabase(); }, 60 * 1000).unref();
        setInterval(() => { backupDatabase(); }, 6 * 60 * 60 * 1000).unref();
    } catch (_) {}

    try {
        const rows = _gsAll.all();
        let converted = 0, expired = 0;
        const now = Date.now();
        for (const r of rows) {
            let raw;
            try { raw = JSON.parse(r.muted); } catch (_) { raw = []; }
            if (Array.isArray(raw)) {
                const obj = {};
                for (const p of raw) if (p) obj[p] = now;
                writeGroupState(r.jid, { muted: JSON.stringify(obj) });
                converted++;
            } else if (raw && typeof raw === 'object') {
                let changed = false;
                for (const k of Object.keys(raw)) {
                    const ts = Number(raw[k]);
                    if (!ts || now - ts >= muteApi.MUTE_TTL_MS) { delete raw[k]; changed = true; expired++; }
                }
                if (changed) writeGroupState(r.jid, { muted: JSON.stringify(raw) });
            }
        }
        if (converted > 0 || expired > 0) {
            console.log(`🧹 Mute: ${converted} grupo(s) migrados para formato novo, ${expired} mute(s) expirado(s) removido(s).`);
        }
    } catch (e) { console.error('❌ Falha ao migrar/limpar muted:', e.message); }
}, 0).unref();

process.on('beforeExit', flushNow);
process.on('SIGINT', () => { flushNow(); process.exit(0); });
process.on('SIGTERM', () => { flushNow(); process.exit(0); });

// ============================================================
// Exports (barrel — compatível com toda a base de código)
// ============================================================
module.exports = {
    isConnectionClosedError,
    readConfig, writeConfig, readStats, incrementRestart, incrementCommand,
    isActiveGroup, activateGroup, deactivateGroup, listActiveGroups,
    isPartialActive, activatePartial, deactivatePartial, listPartialGroups,
    getPartialWaitMs, setPartialWaitMs,
    getGroupData, setGroupData, writeGroupState, saveGroupMenuImage, getPrefixForJid, setGroupPrefix, clearGroupPrefix,
    getThemeForJid, setGroupTheme, clearGroupTheme,
    getStickerPackForJid, getStickerAuthorForJid, setStickerPackForJid, clearStickerPackForJid,
    isViewOnce, getMediaMessage, getContextInfo, getMessageText,
    mediaToSticker, stickerToMedia, changeSpeed, addMetadata, mediaToGif,
    formatUptime, getBotName, react, reactStatus, getVersion,
    saveMessage, getChatHistory, clearChatHistory,
    updateMemberActivity, getTopMember, getMonthlyRank, getGlobalMonthlyRank, getTopGroupsByActivity, clearMonthlyRank, clearAllMonthlyRanks, checkMonthlyReset, _getCurrentMonthKey, _getMonthLabelBr,
    snapshotMonthlyRanks, getRankHistory, backupDatabase,
    recordGroupMessage, recordModEvent, getGroupAnalytics,
    getCachedParticipantName, getGroupParticipantName,
    getAdmins, isUserAdmin, botIsAdmin, getBotJid,
    getGroupLink, setGroupLink, normalizeJid,
    sendMessageSafe, groupMetadataCached, clearGroupMetadataCache,
    canAdminControl,
    ...muteApi,
    getBlacklist, isBlacklisted, addToBlacklist, removeFromBlacklist, clearBlacklist, countBlacklist, parseNumberToJid, normalizeBlacklistJid, normalizePhoneNumber, extractPhoneFromText,
    normalizeLoginPhone, isLoginAllowed, listLoginAllowed, addLoginAllowed, removeLoginAllowed, clearLoginAllowed,
    getSenderLoginPhones, isBotOwner, canUseLogin,
    getAntifloodConfig, setAntifloodConfig, toggleAntiflood, toggleAntifloodAdmin,
    isDashboardEnabled, setDashboardEnabled, listDashboardGroups, getDashboardPreference,
    isNewsEnabled, setNewsEnabled, listNewsGroups,
    getNewsState, setNewsState, clearNewsState, clearAllNewsState,
    insertDashboardLog, loadDashboardHistory, trimDashboardLogs, countDashboardLogs,
    updateDashboardLogReactions, updateDashboardLogMedia, selectDashboardLogsWithInlineMedia,
    clearDashboardLogs, deleteDashboardLogsByJid, getDashboardLogByMessageId,
    upsertDashboardGroupInfo, getDashboardGroupInfo, listDashboardGroupInfos, deleteDashboardGroupInfo,
    insertDashboardVisit, getActiveUsers, getVisitHistory, cleanupDashboardVisits,
    addFeedback, listFeedback, countFeedback, clearFeedback, FEEDBACK_MAX, FEEDBACK_LIMIT,
    upsertPessoa, getPessoa, searchPessoas, listPessoas, countPessoas, deletePessoa, updatePessoa, clearPessoaFoto,
    aniversariantes, pessoasPorCidade, agruparCidades, pessoaAleatoria, saveFichaPhoto,
    flushNow, checkpointWal,
    DEFAULT_CONFIG,
    getDefaultConfig: () => ({ ...DEFAULT_CONFIG })
};
