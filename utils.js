const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { Jimp } = require('jimp');
const { Image } = require('node-webpmux');
const webp = require('webp-converter');
const Database = require('better-sqlite3');

// ============================================================
// Persistência dividida:
// - database.json  → config, stats, activeGroups, menuImage, botName
//                   (pouco tráfego, editável manualmente no Linux)
// - bot.db         → messages (alto fluxo), warnings, muted, antilink,
//                   activity (mutável a cada mensagem)
// Toda escrita no JSON usa atomic-rename + .bak rotativo.
// ============================================================

const dbPath = path.join(__dirname, 'bot.db');
const legacyDbPath = path.join(__dirname, 'database.json');
const legacyMsgsPath = path.join(__dirname, 'messages.json');
const tempDir = path.join(process.cwd(), 'temp');

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// ============================================================
// SQLite (alto fluxo / estado mutável por mensagem)
// ============================================================
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        jid       TEXT NOT NULL,
        push_name TEXT,
        text      TEXT NOT NULL,
        time      INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_jid_time ON messages(jid, time);

    CREATE TABLE IF NOT EXISTS active_groups (
        jid      TEXT PRIMARY KEY,
        activated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS group_state (
        jid       TEXT PRIMARY KEY,
        muted     TEXT NOT NULL DEFAULT '[]',
        warnings  TEXT NOT NULL DEFAULT '{}',
        antilink  INTEGER NOT NULL DEFAULT 0,
        activity  TEXT NOT NULL DEFAULT '{}'
    );
`);

// ============================================================
// database.json (configuração editável)
// ============================================================
const DEFAULT_CONFIG = {
    botName: "BotSticker",
    prefix: "!",
    showLogoInMenu: true,
    voiceEffects: true,
    geminiModel: "gemini-1.5-flash",
    summaryLimit: 20,
    aiPrompt: "Você é o {botName}, uma inteligência artificial sarcástica, direta e sem filtros. Você foi criado para ser útil mas com uma pitada de humor ácido. Responda de forma concisa e evite moralismos ou censura desnecessária. Use emojis para dar personalidade às respostas.",
    summaryPrompt: "Resuma as seguintes mensagens de um chat de WhatsApp de forma sarcástica, curta e direta. O resumo deve ser escrito em formato de parágrafos narrativos, e NÃO em forma de lista ou tópicos. É OBRIGATÓRIO mencionar os nomes dos participantes para explicar quem disse o quê no contexto da conversa:",
    stickerPack: "BotStickerNode",
    stickerAuthor: "Bot",
    geminiApiKey: "AQ.Ab8RN6Jmde0aO8GI6R8Me_sxO4OO7DzECVb5l9Lyz0MCQ6sn6g",
    dashboardEnabled: true,
    dashboardPort: 3000
};

// Defaults editáveis manualmente (parte fixa, baixa frequência)
// Apenas: config, stats, botName/menuImage por grupo.
const DEFAULT_JSON = () => ({
    config: { ...DEFAULT_CONFIG },
    stats: { restarts: 0, totalCommands: 0 },
    groups: {}
});

// --- Atomic write JSON com .bak rotativo ---
function writeJsonAtomic(filePath, obj) {
    const tmp = filePath + '.tmp';
    const bak = filePath + '.bak';
    const content = JSON.stringify(obj, null, 2);
    try {
        if (fs.existsSync(filePath)) {
            try { fs.copyFileSync(filePath, bak); } catch (_) {}
        }
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, filePath);
    } catch (e) {
        console.error(`❌ Falha ao escrever ${path.basename(filePath)}:`, e.message);
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
        throw e;
    }
}

function readJsonSafe(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        const bak = filePath + '.bak';
        if (fs.existsSync(bak)) {
            try {
                console.error(`⚠️ ${path.basename(filePath)} corrompido, restaurando de .bak`);
                return JSON.parse(fs.readFileSync(bak, 'utf8'));
            } catch (e2) {
                console.error(`❌ ${path.basename(filePath)} e .bak ilegíveis:`, e2.message);
                return null;
            }
        }
        console.error(`❌ ${path.basename(filePath)} corrompido e sem .bak:`, e.message);
        return null;
    }
}

// --- Migração do banco antigo (única vez) ---
// Estrutura antiga: tudo no SQLite (kv bot_state_v1).
// Novo: JSON para editáveis, SQLite para o resto.
function migrateLegacyUnifiedDB() {
    // A tabela kv não existe mais no schema novo; só havia dados se o bot rodou
    // uma versão intermediária. Verifica via try/catch.
    let row;
    try {
        row = db.prepare('SELECT value FROM kv WHERE key = ?').get('bot_state_v1');
    } catch (e) {
        return false;
    }
    if (!row) return false;
    console.log('🔄 Detectado banco unificado antigo, migrando para JSON+SQLite split...');
    try {
        const old = JSON.parse(row.value);
        const json = DEFAULT_JSON();
        json.config = { ...DEFAULT_CONFIG, ...(old.config || {}) };
        json.stats = { restarts: 0, totalCommands: 0, ...(old.stats || {}) };
        const oldSettings = old.groups?.settings || {};
        const jsonGroups = {};
        for (const [jid, s] of Object.entries(oldSettings)) {
            const fixed = {};
            if (s.botName) fixed.botName = s.botName;
            if (s.menuImage) fixed.menuImage = s.menuImage;
            if (Object.keys(fixed).length > 0) jsonGroups[jid] = fixed;
        }
        json.groups = jsonGroups;
        writeJsonAtomic(legacyDbPath, json);
        console.log('✅ Migração do estado editável -> database.json');

        // activeGroups -> tabela active_groups
        const agInsert = db.prepare('INSERT OR REPLACE INTO active_groups (jid, activated_at) VALUES (?, ?)');
        const oldActive = Array.isArray(old.groups?.activeGroups) ? old.groups.activeGroups : [];
        const now = Date.now();
        for (const jid of oldActive) agInsert.run(jid, now);
        if (oldActive.length > 0) console.log(`✅ Migração: ${oldActive.length} activeGroups -> bot.db`);

        // Estado mutável por grupo vai para group_state
        const ins = db.prepare(`
            INSERT OR REPLACE INTO group_state (jid, muted, warnings, antilink, activity)
            VALUES (?, ?, ?, ?, ?)
        `);
        for (const [jid, s] of Object.entries(oldSettings)) {
            ins.run(
                jid,
                JSON.stringify(Array.isArray(s.muted) ? s.muted : []),
                JSON.stringify(s.warnings && typeof s.warnings === 'object' ? s.warnings : {}),
                s.antilink ? 1 : 0,
                JSON.stringify({})
            );
        }
        // Activity global
        const activityData = old.groups?.activity?.data || {};
        for (const [jid, members] of Object.entries(activityData)) {
            const existing = db.prepare('SELECT activity FROM group_state WHERE jid = ?').get(jid);
            const cur = existing ? JSON.parse(existing.activity) : {};
            for (const [sender, info] of Object.entries(members || {})) {
                cur[sender] = info;
            }
            db.prepare('INSERT OR REPLACE INTO group_state (jid, muted, warnings, antilink, activity) VALUES (?, ?, ?, ?, ?)')
              .run(jid, '[]', '{}', 0, JSON.stringify(cur));
        }
        try { db.prepare('DELETE FROM kv WHERE key = ?').run('bot_state_v1'); } catch (_) {}
        console.log('✅ Migração do estado mutável -> bot.db (group_state)');
        return true;
    } catch (e) {
        console.error('❌ Falha ao migrar banco unificado:', e.message);
        return false;
    }
}

function migrateLegacyMessagesJson() {
    if (!fs.existsSync(legacyMsgsPath)) return;
    try {
        const raw = fs.readFileSync(legacyMsgsPath, 'utf8');
        const parsed = JSON.parse(raw);
        const insert = db.prepare('INSERT INTO messages (jid, push_name, text, time) VALUES (?, ?, ?, ?)');
        const tx = db.transaction((obj) => {
            for (const [jid, list] of Object.entries(obj || {})) {
                if (!Array.isArray(list)) continue;
                for (const m of list) {
                    if (!m || !m.text) continue;
                    insert.run(jid, m.pushName || '', String(m.text), Number(m.time) || Date.now());
                }
            }
        });
        tx(parsed);
        fs.renameSync(legacyMsgsPath, legacyMsgsPath + '.migrated');
        console.log('✅ Migração: messages.json -> bot.db (messages)');
    } catch (e) {
        console.error('❌ Falha ao migrar messages.json:', e.message);
    }
}

// Migra activeGroups + settings do JSON legado (estrutura antiga) para o novo formato
function migrateLegacyActiveGroups() {
    if (!fs.existsSync(legacyDbPath)) return;
    let json;
    try {
        json = JSON.parse(fs.readFileSync(legacyDbPath, 'utf8'));
    } catch (e) {
        return; // .bak é tratado separadamente
    }

    // activeGroups -> tabela SQLite
    const oldActive = Array.isArray(json.groups?.activeGroups) ? json.groups.activeGroups : [];
    if (oldActive.length > 0 && !json.stats._activeGroupsMigrated) {
        const agInsert = db.prepare('INSERT OR IGNORE INTO active_groups (jid, activated_at) VALUES (?, ?)');
        const now = Date.now();
        let count = 0;
        for (const jid of oldActive) {
            const r = agInsert.run(jid, now);
            if (r.changes > 0) count++;
        }
        console.log(`✅ Migração: ${count} activeGroups JSON -> bot.db`);
    }

    // settings[jid] -> group_state (muted/warnings/antilink) + groups[jid] (botName/menuImage)
    const oldSettings = (json.groups?.settings && typeof json.groups.settings === 'object') ? json.groups.settings : null;
    if (oldSettings && !json.stats._settingsMigrated) {
        const gsInsert = db.prepare(`
            INSERT OR REPLACE INTO group_state (jid, muted, warnings, antilink, activity)
            VALUES (?, ?, ?, ?, ?)
        `);
        const newGroups = {};
        for (const [jid, s] of Object.entries(oldSettings)) {
            // Estado mutável -> group_state
            gsInsert.run(
                jid,
                JSON.stringify(Array.isArray(s.muted) ? s.muted : []),
                JSON.stringify(s.warnings && typeof s.warnings === 'object' ? s.warnings : {}),
                s.antilink ? 1 : 0,
                JSON.stringify({})
            );
            // Estado editável -> JSON direto
            const fixed = {};
            if (s.botName) fixed.botName = s.botName;
            if (s.menuImage) fixed.menuImage = s.menuImage;
            if (Object.keys(fixed).length > 0) newGroups[jid] = fixed;
        }
        json.groups = newGroups;
        json.stats._settingsMigrated = Date.now();
        json.stats._activeGroupsMigrated = Date.now();
        writeJsonAtomic(legacyDbPath, json);
        console.log(`✅ Migração: settings JSON -> group_state (SQLite) + groups JSON`);
    } else if (oldActive.length > 0 && !json.stats._activeGroupsMigrated) {
        // Só migrou activeGroups (não tinha settings antigos)
        delete json.groups.activeGroups;
        if (json.groups.settings) delete json.groups.settings;
        if (Object.keys(json.groups).length === 0) delete json.groups;
        json.stats._activeGroupsMigrated = Date.now();
        writeJsonAtomic(legacyDbPath, json);
    }
}

// ============================================================
// Carregamento de database.json com validação
// ============================================================
let _jsonCache = null;
let _jsonDirty = false;
let _jsonFlushTimer = null;
const JSON_FLUSH_DEBOUNCE = 300; // ms — coalescing simples para não martelar disco

function loadJsonDB() {
    const fromFile = readJsonSafe(legacyDbPath);
    if (fromFile) {
        _jsonCache = mergeWithDefaults(fromFile);

        // Se o arquivo em disco está inline (sem indent), reformata agora
        try {
            const raw = fs.readFileSync(legacyDbPath, 'utf8');
            if (raw.length > 0 && !raw.includes('\n  ')) {
                console.log('🔧 database.json está inline, reformatando para indent 2...');
                writeJsonAtomic(legacyDbPath, _jsonCache);
            }
        } catch (_) {}
    } else {
        _jsonCache = DEFAULT_JSON();
        writeJsonAtomic(legacyDbPath, _jsonCache);
        console.log('📝 database.json criado com defaults');
    }
}

function mergeWithDefaults(obj) {
    const d = DEFAULT_JSON();
    return {
        config: { ...d.config, ...(obj.config || {}) },
        stats: { ...d.stats, ...(obj.stats || {}) },
        groups: {
            ...(obj.groups || {})
        }
    };
}

function scheduleJsonFlush() {
    _jsonDirty = true;
    if (_jsonFlushTimer) return;
    _jsonFlushTimer = setTimeout(() => {
        _jsonFlushTimer = null;
        if (!_jsonDirty) return;
        try {
            writeJsonAtomic(legacyDbPath, _jsonCache);
            _jsonDirty = false;
        } catch (e) {
            console.error('❌ Falha ao persistir database.json:', e.message);
        }
    }, JSON_FLUSH_DEBOUNCE);
}

function flushJsonNow() {
    if (_jsonFlushTimer) { clearTimeout(_jsonFlushTimer); _jsonFlushTimer = null; }
    if (_jsonDirty) {
        try {
            writeJsonAtomic(legacyDbPath, _jsonCache);
            _jsonDirty = false;
        } catch (e) {
            console.error('❌ Flush final database.json falhou:', e.message);
        }
    }
}

// ============================================================
// group_state (SQLite) — mutável por evento
// ============================================================
const _gsGet = db.prepare('SELECT muted, warnings, antilink, activity FROM group_state WHERE jid = ?');
const _gsUpsert = db.prepare(`
    INSERT INTO group_state (jid, muted, warnings, antilink, activity)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
        muted = excluded.muted,
        warnings = excluded.warnings,
        antilink = excluded.antilink,
        activity = excluded.activity
`);
const _gsDelete = db.prepare('DELETE FROM group_state WHERE jid = ?');
const _gsAll = db.prepare('SELECT jid, muted, warnings, antilink, activity FROM group_state');

function ensureGroupState(jid) {
    let row = _gsGet.get(jid);
    if (!row) {
        _gsUpsert.run(jid, '[]', '{}', 0, '{}');
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

function safeJson(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
}

// ============================================================
// API pública (mantida compatível com todos os comandos)
// ============================================================

// --- JSON: config / stats / activeGroups / settings.botName|menuImage ---
function readDB() {
    if (!_jsonCache) loadJsonDB();
    return _jsonCache;
}

function readConfig() { return readDB().config; }

function writeConfig(newConfig) {
    const j = readDB();
    j.config = newConfig;
    scheduleJsonFlush();
}

function getGroupLink() {
    return readDB().config?.linkgrupo || null;
}

function setGroupLink(link) {
    const j = readDB();
    j.config.linkgrupo = link;
    scheduleJsonFlush();
}

function readStats() { return readDB().stats; }

function incrementRestart() {
    const j = readDB();
    j.stats.restarts = (j.stats.restarts || 0) + 1;
    scheduleJsonFlush();
    return j.stats.restarts;
}

function incrementCommand() {
    const j = readDB();
    j.stats.totalCommands = (j.stats.totalCommands || 0) + 1;
    scheduleJsonFlush();
    return j.stats.totalCommands;
}

function writeDB(data) {
    _jsonCache = data;
    scheduleJsonFlush();
}

// --- Active Groups (SQLite) ---
const _agGet = db.prepare('SELECT jid FROM active_groups');
const _agHas = db.prepare('SELECT 1 FROM active_groups WHERE jid = ?');
const _agInsert = db.prepare('INSERT OR IGNORE INTO active_groups (jid, activated_at) VALUES (?, ?)');
const _agDelete = db.prepare('DELETE FROM active_groups WHERE jid = ?');

function isActiveGroup(jid) {
    try { return !!_agHas.get(jid); } catch (e) { return false; }
}

function activateGroup(jid) {
    const r = _agInsert.run(jid, Date.now());
    return r.changes > 0;
}

function deactivateGroup(jid) {
    const r = _agDelete.run(jid);
    if (r.changes === 0) return false;

    // Limpa settings editáveis (botName/menuImage) do JSON
    const j = readDB();
    if (j.groups[jid]) {
        const menuImage = j.groups[jid].menuImage;
        if (menuImage) {
            const fullPath = path.join(process.cwd(), menuImage);
            if (fs.existsSync(fullPath)) {
                try { fs.unlinkSync(fullPath); } catch (_) {}
            }
        }
        delete j.groups[jid];
        scheduleJsonFlush();
    }

    try { _gsDelete.run(jid); } catch (e) { console.error('❌ Falha ao limpar group_state:', e.message); }
    clearChatHistory(jid);
    clearMuted(jid);

    return true;
}

function listActiveGroups() {
    try {
        return _agGet.all().map(r => r.jid);
    } catch (e) {
        console.error('❌ Falha ao listar active_groups:', e.message);
        return [];
    }
}

// --- Group Settings (visão mesclada JSON + SQLite) ---
// JSON: groups[jid] = { botName, menuImage } (editável manualmente)
// SQLite: group_state[jid] = { muted, warnings, antilink, activity }
function getGroupData(jid) {
    const j = readDB();
    const fixed = j.groups[jid] || {};
    try {
        const row = _gsGet.get(jid);
        if (row) {
            const dyn = parseGroupState(row);
            return { ...fixed, ...dyn };
        }
    } catch (_) {}
    return { ...fixed };
}

function setGroupData(jid, data) {
    const j = readDB();
    const fixedKeys = ['botName', 'menuImage'];
    const dynKeys = ['muted', 'warnings', 'antilink', 'activity'];

    const fixedUpdate = {};
    const dynUpdate = {};
    let hasFixed = false, hasDyn = false;

    for (const [k, v] of Object.entries(data)) {
        if (fixedKeys.includes(k)) { fixedUpdate[k] = v; hasFixed = true; }
        else if (dynKeys.includes(k)) { dynUpdate[k] = v; hasDyn = true; }
        else { fixedUpdate[k] = v; hasFixed = true; }
    }

    if (hasFixed) {
        j.groups[jid] = { ...(j.groups[jid] || {}), ...fixedUpdate };
        scheduleJsonFlush();
    }
    if (hasDyn) {
        const cur = ensureGroupState(jid);
        const curParsed = parseGroupState(cur);
        const merged = { ...curParsed, ...dynUpdate };
        let mutedObj = merged.muted;
        if (Array.isArray(mutedObj)) {
            const converted = {};
            const ts = Date.now();
            for (const p of mutedObj) if (p) converted[p] = ts;
            mutedObj = converted;
        } else if (!mutedObj || typeof mutedObj !== 'object') {
            mutedObj = {};
        }
        _gsUpsert.run(
            jid,
            JSON.stringify(mutedObj),
            JSON.stringify(merged.warnings || {}),
            merged.antilink ? 1 : 0,
            JSON.stringify(merged.activity || {})
        );
    }
}

async function saveGroupMenuImage(jid, buffer) {
    const hash = crypto.createHash('md5').update(jid).digest('hex');
    const fileName = `menu_${hash}.png`;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
    const filePath = path.join(uploadsDir, fileName);

    const image = await Jimp.read(buffer);
    await image.write(filePath);

    const relativePath = `uploads/${fileName}`;
    setGroupData(jid, { menuImage: relativePath });
    return filePath;
}

// --- Activity (alto fluxo, mutável por mensagem) ---
function updateMemberActivity(jid, sender, senderName) {
    const row = ensureGroupState(jid);
    const act = safeJson(row.activity, {});
    if (!act[jid]) act[jid] = {};
    if (!act[jid][sender]) act[jid][sender] = { name: senderName, count: 0 };
    act[jid][sender].count += 1;
    _gsUpsert.run(jid, row.muted, row.warnings, row.antilink, JSON.stringify(act));
}

function getTopMember(jid) {
    try {
        const row = _gsGet.get(jid);
        if (!row) return 'Nenhum registro hoje';
        const act = safeJson(row.activity, {});
        const groupActivity = act[jid];
        if (!groupActivity) return 'Nenhum registro hoje';

        let topSender = null;
        let maxCount = -1;
        for (const sender in groupActivity) {
            if (groupActivity[sender].count > maxCount) {
                maxCount = groupActivity[sender].count;
                topSender = groupActivity[sender].name;
            }
        }
        return topSender || 'Nenhum registro hoje';
    } catch (_) {
        return 'Nenhum registro hoje';
    }
}

// --- Mensagens (alto fluxo, coalesced) ---
const _msgInsert = db.prepare('INSERT INTO messages (jid, push_name, text, time) VALUES (?, ?, ?, ?)');
const _msgDeleteByJid = db.prepare('DELETE FROM messages WHERE jid = ?');
const _msgTrimByJid = db.prepare(`
    DELETE FROM messages
    WHERE jid = ? AND id NOT IN (
        SELECT id FROM messages WHERE jid = ? ORDER BY time DESC LIMIT ?
    )
`);
const _msgSelectByJid = db.prepare(`
    SELECT push_name as pushName, text, time
    FROM messages
    WHERE jid = ?
    ORDER BY time DESC
    LIMIT ?
`);

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
    for (const r of toInsert) {
        if (!limitsByJid.has(r.jid)) limitsByJid.set(r.jid, r.limit);
    }

    try {
        const tx = db.transaction((rows) => {
            for (const r of rows) {
                _msgInsert.run(r.jid, r.pushName, r.text, r.time);
            }
            for (const [jid, limit] of limitsByJid) {
                _msgTrimByJid.run(jid, jid, limit);
            }
        });
        tx(toInsert);
    } catch (e) {
        console.error('❌ Falha ao gravar messages:', e.message);
    }
}

function scheduleMsgFlush() {
    if (_msgFlushTimer) return;
    _msgFlushTimer = setTimeout(() => {
        _msgFlushTimer = null;
        flushMessagesSync();
    }, MSG_FLUSH_INTERVAL);
}

function saveMessage(jid, pushName, text) {
    if (!text) return;
    const j = readDB();
    const limit = j.config.summaryLimit || 20;

    _msgBuffer.push({ jid, pushName: pushName || '', text: String(text), time: Date.now(), limit });
    const cnt = (_msgBufferByJid.get(jid) || 0) + 1;
    _msgBufferByJid.set(jid, cnt);

    if (cnt >= limit) {
        flushMessagesSync();
        return;
    }
    if (_msgBuffer.length >= MSG_FLUSH_BATCH) {
        flushMessagesSync();
        return;
    }
    scheduleMsgFlush();
}

function getChatHistory(jid, limit = 20) {
    flushMessagesSync();
    try {
        const rows = _msgSelectByJid.all(jid, limit);
        return rows.reverse();
    } catch (e) {
        console.error('❌ Falha ao ler histórico:', e.message);
        return [];
    }
}

function clearChatHistory(jid) {
    flushMessagesSync();
    try { _msgDeleteByJid.run(jid); } catch (e) { console.error('❌ Falha ao limpar histórico:', e.message); }
    _msgBufferByJid.delete(jid);
}

// --- Mídia / Sticker helpers (inalterados) ---
function isViewOnce(message) {
    if (!message) return false;
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension) return true;
    const media = m.imageMessage || m.videoMessage || m.audioMessage;
    return !!(media && (media.viewOnce === true || media.viewOnce === 1));
}

function getMediaMessage(message) {
    if (!message) return null;
    let m = message;
    for (let i = 0; i < 5; i++) {
        if (m.ephemeralMessage) m = m.ephemeralMessage.message;
        else if (m.viewOnceMessage) m = m.viewOnceMessage.message;
        else if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
        else if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
        else if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
        else break;
    }
    if (m.imageMessage || m.videoMessage || m.stickerMessage || m.audioMessage || m.documentMessage) return m;
    if (m.url && (m.mimetype || m.fileLength)) return m;
    return null;
}

async function addMetadata(buffer, pack, author) {
    try {
        const img = new Image();
        await img.load(buffer);
        const exif = Buffer.concat([
            Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]),
            Buffer.from(JSON.stringify({
                "sticker-pack-id": `bot-${crypto.randomBytes(4).toString('hex')}`,
                "sticker-pack-name": pack,
                "sticker-pack-publisher": author,
                "emojis": ["✅"]
            }), 'utf-8')
        ]);
        exif.writeUInt32LE(exif.length - 22, 14);
        img.exif = exif;
        return await img.save(null);
    } catch (e) {
        console.error('❌ [METADATA] Falha:', e.message);
        return buffer;
    }
}

async function mediaToSticker(buffer, mimeType, pack, author) {
    const config = readConfig();
    const finalPack = pack || config.botName || 'Bot';
    const finalAuthor = author || `${config.botName}` || 'Bot';
    const isVideo = mimeType.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');

    const inputPath = path.join(tempDir, `stk_in_${tempId}${isVideo ? '.mp4' : '.png'}`);
    const intermediatePath = path.join(tempDir, `stk_inter_${tempId}${isVideo ? '.gif' : '.png'}`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.webp`);

    try {
        if (!isVideo) {
            const image = await Jimp.read(buffer);
            image.resize({ w: 512, h: 512 });
            const pngBuffer = await image.getBuffer('image/png');
            fs.writeFileSync(inputPath, pngBuffer);
            await webp.cwebp(inputPath, outputPath, "-q 60");
        } else {
            fs.writeFileSync(inputPath, buffer);
            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .inputOptions(['-t 6'])
                    .outputOptions([
                        '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1',
                        '-r', '12'
                    ])
                    .toFormat('gif')
                    .on('end', resolve)
                    .on('error', reject)
                    .save(intermediatePath);
            });
            await webp.gwebp(intermediatePath, outputPath, "-q 60");
        }

        return await addMetadata(fs.readFileSync(outputPath), finalPack, finalAuthor);
    } catch (error) {
        console.error('❌ [CONVERSÃO] Falha:', error.message);
        throw error;
    } finally {
        [inputPath, intermediatePath, outputPath].forEach(p => {
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
        });
    }
}

async function stickerToMedia(buffer, isAnimated = false) {
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `stk_in_${tempId}.webp`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.${isAnimated ? 'mp4' : 'png'}`);
    try {
        fs.writeFileSync(inputPath, buffer);
        await new Promise((resolve, reject) => {
            let ff = ffmpeg(inputPath);
            if (isAnimated) ff.outputOptions(['-pix_fmt yuv420p', '-c:v libx264', '-crf 18', '-preset slow', '-movflags +faststart', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2']).toFormat('mp4');
            else ff.outputOptions(['-vcodec png', '-compression_level 0', '-f image2']);
            ff.on('end', resolve).on('error', reject).save(outputPath);
        });
        return { buffer: fs.readFileSync(outputPath), mime: isAnimated ? 'video/mp4' : 'image/png', ext: isAnimated ? 'mp4' : 'png' };
    } catch (err) {
        console.error('❌ [FFMPEG] Falha:', err.message);
        throw err;
    } finally {
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
    }
}

async function changeSpeed(buffer, mimeType, speed = 1.0) {
    const config = readConfig();
    const isVideo = mimeType.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `speed_in_${tempId}${isVideo ? '.mp4' : '.ogg'}`);
    const outputPath = path.join(tempDir, `speed_out_${tempId}${isVideo ? '.mp4' : '.opus'}`);
    try {
        fs.writeFileSync(inputPath, buffer);
        await new Promise((resolve, reject) => {
            let ff = ffmpeg(inputPath);
            let audioFilter = `atempo=${speed}`;
            if (config.voiceEffects) {
                const rate = 44100 * speed;
                audioFilter = `asetrate=${rate},atempo=1.0`;
            }
            if (isVideo) {
                const pts = 1 / speed;
                ff.outputOptions([
                    `-filter:v setpts=${pts}*PTS`,
                    `-filter:a ${audioFilter}`,
                    '-c:v libx264',
                    '-preset fast',
                    '-c:a aac',
                    '-movflags +faststart'
                ]);
            } else {
                ff.outputOptions([
                    `-filter:a ${audioFilter}`,
                    '-c:a libopus',
                    '-b:a 48k',
                    '-vbr on',
                    '-compression_level 10'
                ]).toFormat('ogg');
            }
            ff.on('end', resolve).on('error', reject).save(outputPath);
        });
        return fs.readFileSync(outputPath);
    } catch (e) {
        console.error('❌ [SPEED] Falha:', e.message);
        throw e;
    } finally {
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
    }
}

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
    } catch (error) {
        return lastBotResponse;
    }
}

function getMessageText(message) {
    if (!message) return '';
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    if (!m) return '';
    return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}

async function getAdmins(sock, jid) {
    try {
        const metadata = await sock.groupMetadata(jid);
        return metadata.participants.filter(p => p.admin || p.isSuperAdmin).map(p => p.id);
    } catch (e) {
        return [];
    }
}

// ============================================================
// Mute persistido em SQLite (group_state.muted)
// Estrutura armazenada: { "<participantJid>": <timestampMs>, ... }
// Auto-expira após MUTE_TTL_MS (12h). Ao expirar, a entrada é removida.
// ============================================================
const MUTE_TTL_MS = 12 * 60 * 60 * 1000;

function _readMutedObj(jid) {
    try {
        const row = _gsGet.get(jid);
        if (!row) return {};
        const v = safeJson(row.muted, {});
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch (_) {
        return {};
    }
}

function _writeMutedObj(jid, obj) {
    const cur = ensureGroupState(jid);
    const curParsed = parseGroupState(cur);
    _gsUpsert.run(
        jid,
        JSON.stringify(obj || {}),
        cur.warnings || '{}',
        curParsed.antilink ? 1 : 0,
        cur.activity || '{}'
    );
}

function cleanupMuted(jid, now = Date.now()) {
    const obj = _readMutedObj(jid);
    const keys = Object.keys(obj);
    if (keys.length === 0) return false;
    let changed = false;
    for (const k of keys) {
        const ts = Number(obj[k]);
        if (!ts || now - ts >= MUTE_TTL_MS) {
            delete obj[k];
            changed = true;
        }
    }
    if (changed) _writeMutedObj(jid, obj);
    return changed;
}

function cleanupAllMuted(now = Date.now()) {
    try {
        const rows = _gsAll.all();
        for (const r of rows) cleanupMuted(r.jid, now);
    } catch (e) {
        console.error('❌ Falha no cleanup geral de muted:', e.message);
    }
}

function isMuted(jid, participant) {
    if (!jid || !participant) return false;
    const obj = _readMutedObj(jid);
    const ts = Number(obj[participant]);
    if (!ts) return false;
    if (Date.now() - ts >= MUTE_TTL_MS) {
        delete obj[participant];
        _writeMutedObj(jid, obj);
        return false;
    }
    return true;
}

function addMuted(jid, participant) {
    if (!jid || !participant) return false;
    const obj = _readMutedObj(jid);
    const ts = Number(obj[participant]);
    const now = Date.now();
    if (ts && (now - ts) < MUTE_TTL_MS) return false;
    obj[participant] = now;
    _writeMutedObj(jid, obj);
    return true;
}

function removeMuted(jid, participant) {
    if (!jid || !participant) return false;
    const obj = _readMutedObj(jid);
    if (!(participant in obj)) return false;
    delete obj[participant];
    _writeMutedObj(jid, obj);
    return true;
}

function listMuted(jid) {
    cleanupMuted(jid);
    return Object.keys(_readMutedObj(jid));
}

function clearMuted(jid) {
    if (!jid) return;
    const cur = ensureGroupState(jid);
    const curParsed = parseGroupState(cur);
    _gsUpsert.run(jid, '{}', cur.warnings || '{}', curParsed.antilink ? 1 : 0, cur.activity || '{}');
}

function normalizeJid(jid) {
    if (!jid) return jid;
    const [user, ...rest] = jid.split(':');
    const after = rest.length > 0 ? rest.join(':') : jid;
    const atIdx = after.indexOf('@');
    const domain = atIdx >= 0 ? after.slice(atIdx + 1) : 's.whatsapp.net';
    return `${user}@${domain}`;
}

function getVersion() {
    try {
        return execSync('git log -1 --format=%s').toString().trim();
    } catch (e) {
        return 'v1.0.0';
    }
}

function flushNow() {
    flushJsonNow();
    flushMessagesSync();
}

// ============================================================
// Inicialização
// ============================================================
migrateLegacyUnifiedDB();
migrateLegacyMessagesJson();
migrateLegacyActiveGroups();
loadJsonDB();

// Activity diária: não persiste no JSON. Zera no boot se mudou o dia.
const today = new Date().toLocaleDateString();
try {
    const rows = _gsAll.all();
    const tx = db.transaction((rs) => {
        for (const r of rs) {
            const act = safeJson(r.activity, {});
            // act = { [jid]: { [sender]: info } } — limpamos tudo no boot de novo dia
            _gsUpsert.run(r.jid, r.muted, r.warnings, r.antilink, '{}');
        }
    });
    // Como não armazenamos a data no SQLite, a checagem do "dia mudou" é feita
    // usando um marcador simples em database.json.stats._activityDate.
    const j = _jsonCache;
    if (j.stats._activityDate !== today) {
        tx(rows);
        j.stats._activityDate = today;
        scheduleJsonFlush();
        console.log(`📅 Activity diária resetada para ${today}`);
    }
} catch (e) {
    console.error('❌ Falha ao resetar activity:', e.message);
}

// Migração do formato antigo de muted (array) -> objeto com timestamp,
// e limpeza de mutes expirados (>12h) no boot.
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
            _gsUpsert.run(r.jid, JSON.stringify(obj), r.warnings, r.antilink, r.activity);
            converted++;
        } else if (raw && typeof raw === 'object') {
            let changed = false;
            for (const k of Object.keys(raw)) {
                const ts = Number(raw[k]);
                if (!ts || now - ts >= MUTE_TTL_MS) { delete raw[k]; changed = true; expired++; }
            }
            if (changed) _gsUpsert.run(r.jid, JSON.stringify(raw), r.warnings, r.antilink, r.activity);
        }
    }
    if (converted > 0 || expired > 0) {
        console.log(`🧹 Mute: ${converted} grupo(s) migrados para formato novo, ${expired} mute(s) expirado(s) removido(s).`);
    }
} catch (e) {
    console.error('❌ Falha ao migrar/limpar muted:', e.message);
}

process.on('beforeExit', flushNow);
process.on('SIGINT', () => { flushNow(); process.exit(0); });
process.on('SIGTERM', () => { flushNow(); process.exit(0); });

module.exports = {
    readDB, writeDB,
    isActiveGroup, activateGroup, deactivateGroup, listActiveGroups,
    getGroupData, setGroupData, saveGroupMenuImage,
    isViewOnce, getMediaMessage, mediaToSticker, stickerToMedia,
    readStats, incrementRestart, incrementCommand, formatUptime,
    readConfig, writeConfig, saveMessage, getChatHistory,
    changeSpeed, getBotName, react, getMessageText, getVersion,
    updateMemberActivity, getTopMember, getAdmins,
    getGroupLink, setGroupLink, normalizeJid,
    isMuted, addMuted, removeMuted, listMuted, clearMuted,
    flushNow
};