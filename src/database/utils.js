require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { Jimp } = require('jimp');

const { db, tempDir, checkpointWal } = require('./db');
const { migrateLegacyUnifiedDB, migrateLegacyMessagesJson, migrateLegacyActiveGroups, migrateJsonToSqlite } = require('./migrate');
const { addMetadata, mediaToSticker, stickerToMedia, changeSpeed } = require('./sticker');
const { isViewOnce, getMediaMessage, getContextInfo, getMessageText } = require('./media');

// ============================================================
// Prepared statements (group_state)
// ============================================================
const _gsGet = db.prepare('SELECT muted, warnings, antilink, activity, bot_name, menu_image FROM group_state WHERE jid = ?');
const _gsUpsert = db.prepare(`
    INSERT INTO group_state (jid, muted, warnings, antilink, activity, bot_name, menu_image)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
        muted = excluded.muted,
        warnings = excluded.warnings,
        antilink = excluded.antilink,
        activity = excluded.activity,
        bot_name = excluded.bot_name,
        menu_image = excluded.menu_image
`);
const _gsDelete = db.prepare('DELETE FROM group_state WHERE jid = ?');
const _gsAll = db.prepare('SELECT jid, muted, warnings, antilink, activity, bot_name, menu_image FROM group_state');

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
        const cur = _gsGet.get(jid) || { warnings: '{}', antilink: 0, activity: '{}', bot_name: null, menu_image: null };
        _gsUpsert.run(jid, muted ?? cur.muted, warnings ?? cur.warnings, antilink ?? cur.antilink, activity ?? cur.activity, cur.bot_name, cur.menu_image);
    }
});

// ============================================================
// Config management (SQLite)
// ============================================================
const DEFAULT_CONFIG = {
    botName: "Antigravity Bot",
    prefix: "!",
    newsEnabled: true,
    dashboardUrl: "https://botantigravity.duckdns.org",
    showLogoInMenu: true,
    voiceEffects: true,
    aiModel: "openrouter/free",
    aiMaxTokens: 500,
    aiTemperature: 0.7,
    aiMaxPromptLength: 2000,
    aiCacheTtl: 300000,
    aiRetryCount: 2,
    summaryLimit: 20,
    aiPrompt: "Você é o {botName}, uma inteligência artificial sarcástica, direta e sem filtros. Você foi criado para ser útil mas com uma pitada de humor ácido. Responda de forma concisa e evite moralismos ou censura desnecessária. Use emojis para dar personalidade às respostas.",
    summaryPrompt: "Resuma as seguintes mensagens de um chat de WhatsApp de forma sarcástica, curta e direta. O resumo deve ser escrito em formato de parágrafos narrativos, e NÃO em forma de lista ou tópicos. É OBRIGATÓRIO mencionar os nomes dos participantes para explicar quem disse o quê no contexto da conversa:",
    stickerPack: "Antigravity Bot",
    stickerAuthor: "Bot",
    dashboardEnabled: true,
    dashboardPort: 3000,
    dashboardMaxLogs: 200,
    dashboardHistoryHours: 12,
    adminCanControl: false,
    clearDefaultLimit: 10,
    partialWaitMs: 2000,
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
    subSessionsGroups: true,
    dashboardMuted: false
};

function readConfig() {
    const rows = _cfgGetAll.all();
    const dbConfig = {};
    for (const r of rows) {
        try { dbConfig[r.key] = JSON.parse(r.value); } catch { dbConfig[r.key] = r.value; }
    }
    return { ...DEFAULT_CONFIG, ...dbConfig, openrouterApiKey: process.env.OPENROUTER_API_KEY || '' };
}

function writeConfig(newConfig) {
    const tx = db.transaction((cfg) => {
        for (const [k, v] of Object.entries(cfg)) {
            _cfgSet.run(k, JSON.stringify(v));
        }
    });
    tx(newConfig);
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
        _gsUpsert.run(jid, '[]', '{}', 0, '{}', null, null);
        row = _gsGet.get(jid);
    }
    return row;
}

function parseGroupState(row) {
    const mutedRaw = safeJson(row.muted, {});
    const muted = (mutedRaw && typeof mutedRaw === 'object' && !Array.isArray(mutedRaw)) ? mutedRaw : {};
    return {
        muted,
        warnings: safeJson(row.warnings, {}),
        antilink: !!row.antilink,
        activity: safeJson(row.activity, {})
    };
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
    try { _agpDelete.run(jid); } catch (_) {}
    const r = _agInsert.run(jid, Date.now());
    return r.changes > 0;
}

function deactivateGroup(jid) {
    const r = _agDelete.run(jid);
    if (r.changes === 0) return false;
    try {
        const row = _gsGet.get(jid);
        if (row && row.menu_image) {
            const fullPath = path.join(process.cwd(), row.menu_image);
            if (fs.existsSync(fullPath)) { try { fs.unlinkSync(fullPath); } catch (_) {} }
        }
    } catch (_) {}
    try { _gsDelete.run(jid); } catch (e) { console.error('❌ Falha ao limpar group_state:', e.message); }
    try { _agpDelete.run(jid); } catch (_) {}
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
        const r = _agpInsert.run(jid, Date.now());
        return r.changes > 0;
    } catch (e) {
        console.error('❌ Falha ao ativar modo parcial:', e.message);
        return false;
    }
}

function deactivatePartial(jid) {
    if (!jid) return false;
    try { return _agpDelete.run(jid).changes > 0; } catch (e) { return false; }
}

function listPartialGroups() {
    try { return db.prepare('SELECT jid FROM active_groups_partial').all().map(r => r.jid); } catch (e) { return []; }
}

function getPartialWaitMs() {
    try { const v = Number(readConfig().partialWaitMs); if (Number.isFinite(v) && v >= 0) return v; } catch (_) {}
    return 2000;
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
// Group Data (SQLite)
// ============================================================
function getGroupData(jid) {
    try {
        const row = _gsGet.get(jid);
        if (row) return { botName: row.bot_name || undefined, menuImage: row.menu_image || undefined, ...parseGroupState(row) };
    } catch (_) {}
    return {};
}

function setGroupData(jid, data) {
    const cur = ensureGroupState(jid);
    const curParsed = parseGroupState(cur);
    const merged = { ...curParsed };
    let botName = cur.bot_name;
    let menuImage = cur.menu_image;
    for (const [k, v] of Object.entries(data)) {
        if (k === 'botName') botName = v;
        else if (k === 'menuImage') menuImage = v;
        else merged[k] = v;
    }
    let mutedObj = merged.muted;
    if (Array.isArray(mutedObj)) {
        const converted = {};
        const ts = Date.now();
        for (const p of mutedObj) if (p) converted[p] = ts;
        mutedObj = converted;
    } else if (!mutedObj || typeof mutedObj !== 'object') { mutedObj = {}; }
    _gsUpsert.run(jid, JSON.stringify(mutedObj), JSON.stringify(merged.warnings || {}), merged.antilink ? 1 : 0, JSON.stringify(merged.activity || {}), botName || null, menuImage || null);
}

async function saveGroupMenuImage(jid, buffer) {
    const hash = crypto.createHash('md5').update(jid).digest('hex');
    const fileName = `menu_${hash}.png`;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, fileName);
    const image = await Jimp.read(buffer);
    await image.write(filePath);
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
    _activityBuffer.clear();
    for (const [jid, members] of entries) {
        try {
            const row = ensureGroupState(jid);
            const act = safeJson(row.activity, {});
            if (!act[jid]) act[jid] = {};
            for (const [sender, info] of members) {
                if (!act[jid][sender]) act[jid][sender] = { name: info.name, count: 0 };
                act[jid][sender].count += info.count;
            }
            _gsUpsert.run(jid, row.muted, row.warnings, row.antilink, JSON.stringify(act), row.bot_name, row.menu_image);
        } catch (_) {}
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
    if (!_activityBuffer.has(jid)) _activityBuffer.set(jid, new Map());
    const members = _activityBuffer.get(jid);
    if (!members.has(sender)) members.set(sender, { name: senderName || 'Usuário', count: 0 });
    members.get(sender).count += 1;
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
    const toInsert = _msgBuffer;
    _msgBuffer = [];
    _msgBufferByJid = new Map();
    const limitsByJid = new Map();
    for (const r of toInsert) { if (!limitsByJid.has(r.jid)) limitsByJid.set(r.jid, r.limit); }
    try {
        db.transaction((rows) => {
            for (const r of rows) _msgInsert.run(r.jid, r.pushName, r.text, r.time);
            for (const [jid, limit] of limitsByJid) _msgTrimByJid.run(jid, jid, limit);
        })(toInsert);
        try { db.pragma('incremental_vacuum(200)'); } catch (_) {}
    } catch (e) { console.error('❌ Falha ao gravar messages:', e.message); }
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

function flushNow() { flushMessagesSync(); if (_activityFlushTimer) { clearTimeout(_activityFlushTimer); _activityFlushTimer = null; } _flushActivity(); }

// ============================================================
// Group metadata cache & admin helpers
// ============================================================
const _gmCache = new Map();
const _gmCacheTtlMs = 5000;

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
    const botUser = botRaw.split('@')[0];
    const admins = await getAdmins(sock, jid);
    return admins.some(p => {
        const ids = [p.id, p.jid, p.lid].filter(Boolean).map(normalizeJid);
        return new Set(ids.map(s => s.split('@')[0])).has(botUser);
    });
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

async function sendMessageSafe(sock, jid, payload, options = {}) {
    const { maxRetries = 3, baseDelayMs = 15000, onRetry } = options;
    const backoffs = _buildBackoffs(baseDelayMs);
    let attempt = 0;
    while (true) {
        try { return await sock.sendMessage(jid, payload, options.sendOptions || {}); } catch (err) {
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

// Background init — não bloqueia startup
setTimeout(() => {
    try {
        const today = new Date().toLocaleDateString();
        const rows = _gsAll.all();
        const tx = db.transaction((rs) => {
            for (const r of rs) _gsUpsert.run(r.jid, r.muted, r.warnings, r.antilink, '{}', r.bot_name, r.menu_image);
        });
        const lastReset = (() => { try { const r = _statsGet.get('_activityDate'); return r ? r.value : 0; } catch { return 0; } })();
        if (lastReset !== today) {
            tx(rows);
            _statsSet.run('_activityDate', today);
            console.log(`📅 Activity diária resetada para ${today}`);
        }
    } catch (e) { console.error('❌ Falha ao resetar activity:', e.message); }

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
                _gsUpsert.run(r.jid, JSON.stringify(obj), r.warnings, r.antilink, r.activity, r.bot_name, r.menu_image);
                converted++;
            } else if (raw && typeof raw === 'object') {
                let changed = false;
                for (const k of Object.keys(raw)) {
                    const ts = Number(raw[k]);
                    if (!ts || now - ts >= muteApi.MUTE_TTL_MS) { delete raw[k]; changed = true; expired++; }
                }
                if (changed) _gsUpsert.run(r.jid, JSON.stringify(raw), r.warnings, r.antilink, r.activity, r.bot_name, r.menu_image);
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
    readConfig, writeConfig, readStats, incrementRestart, incrementCommand,
    isActiveGroup, activateGroup, deactivateGroup, listActiveGroups,
    isPartialActive, activatePartial, deactivatePartial, listPartialGroups,
    getPartialWaitMs, setPartialWaitMs,
    getGroupData, setGroupData, saveGroupMenuImage,
    isViewOnce, getMediaMessage, getContextInfo, getMessageText,
    mediaToSticker, stickerToMedia, changeSpeed, addMetadata,
    formatUptime, getBotName, react, reactStatus, getVersion,
    saveMessage, getChatHistory, clearChatHistory,
    updateMemberActivity, getTopMember,
    getAdmins, isUserAdmin, botIsAdmin, getBotJid,
    getGroupLink, setGroupLink, normalizeJid,
    sendMessageSafe, groupMetadataCached, clearGroupMetadataCache,
    canAdminControl,
    ...muteApi,
    isDashboardEnabled, setDashboardEnabled, listDashboardGroups, getDashboardPreference,
    isNewsEnabled, setNewsEnabled, listNewsGroups,
    getNewsState, setNewsState, clearNewsState, clearAllNewsState,
    insertDashboardLog, loadDashboardHistory, trimDashboardLogs, countDashboardLogs,
    updateDashboardLogReactions, updateDashboardLogMedia, selectDashboardLogsWithInlineMedia,
    clearDashboardLogs, getDashboardLogByMessageId,
    upsertDashboardGroupInfo, getDashboardGroupInfo, listDashboardGroupInfos, deleteDashboardGroupInfo,
    insertDashboardVisit, getActiveUsers, getVisitHistory, cleanupDashboardVisits,
    flushNow, checkpointWal,
    DEFAULT_CONFIG,
    getDefaultConfig: () => ({ ...DEFAULT_CONFIG })
};
