// Sincronização local (bot.db) <-> Turso (nuvem, fonte da verdade).
// Estratégia (uso alternado, um PC por vez):
//  - Boot: PULL nuvem -> local (a nuvem vence; sobrescreve o bot.db local).
//  - Ao salvar / flush / intervalo: PUSH local -> nuvem (upsert em lote).
// Mantém todo o código síncrono existente intacto.
require('dotenv').config();
const { isTursoEnabled, getTursoClient, ensureTursoSchema } = require('./tursoClient');

const SYNC_TABLES = [
    'messages',
    'active_groups',
    'active_groups_partial',
    'group_state',
    'config',
    'stats',
    'dashboard_groups',
    'dashboard_group_info',
    'news_groups',
    'news_state',
    'dashboard_logs',
    'dashboard_visits',
    'group_blacklist',
    'feedback',
    'antiflood_config',
    'login_allowed',
    'group_msg_stats',
    'group_modlog',
    'rank_monthly_history',
    'pessoas',
];

// Tabelas com volume alto: limita o pull/push aos N mais recentes para não estourar boot.
const CAPPED_TABLES = { messages: 2000, dashboard_logs: 2000, dashboard_visits: 500, group_modlog: 2000 };

let _syncTimer = null;
let _pushPending = false;
let _syncRunning = false; // mutex pull/push: nunca rodam juntos
let _pullOk = false; // trava push-até-pull: nenhum PUSH antes do 1º PULL do boot
let _pullFailed = false;
let _pullRefusedLogged = false;
let _lastPullAt = 0;
let _lastPushAt = 0;
let _lastPushRefused = null;

function _localDb() {
    return require('./db').db;
}

function _tableColumns(localDb, table) {
    try {
        const rows = localDb.prepare(`PRAGMA table_info("${table}")`).all();
        return rows.map(r => r.name).filter(Boolean);
    } catch (_) { return []; }
}

function _tableExists(localDb, table) {
    try {
        const r = localDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        return !!r;
    } catch (_) { return false; }
}

function _countLocal(localDb, table) {
    try {
        if (!_tableExists(localDb, table)) return 0;
        const r = localDb.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get();
        return Number(r?.c) || 0;
    } catch (_) { return -1; } // -1 = erro de leitura (suspeito)
}

async function _countCloud(client, table) {
    try {
        const rs = await client.execute({ sql: `SELECT COUNT(*) AS c FROM "${table}"`, args: [] });
        const v = rs.rows?.[0]?.c;
        return Number(v) || 0;
    } catch (e) {
        if (/no such table/i.test(e?.message || '')) return 0;
        return -1;
    }
}

function _localIntegrity() {
    try {
        const row = _localDb().prepare('PRAGMA integrity_check').get();
        const v = row && (row.integrity_check || Object.values(row)[0]);
        return String(v || '').toLowerCase() === 'ok' ? { ok: true } : { ok: false, reason: String(v).slice(0, 200) };
    } catch (e) {
        return { ok: false, reason: e?.message || String(e) };
    }
}

function _quarantineLocal(reason) {
    try {
        const fs = require('fs');
        const path = require('path');
        const { dbPath } = require('./db');
        try { _localDb().pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}h${pad(d.getMinutes())}`;
        const dest = path.join(path.dirname(dbPath), `bot.db.quarentena-${stamp}.db`);
        fs.copyFileSync(dbPath, dest);
        try { console.error(`🚧 [turso] DB local em QUARENTENA (cópia): ${dest} — motivo: ${reason}`); } catch (_) {}
        return dest;
    } catch (e) {
        try { console.error('🚧 [turso] falha ao quarentenar DB local:', e?.message || e); } catch (_) {}
        return null;
    }
}

// Validação pré-PUSH. Retorna {ok:true} ou {ok:false, reason}.
// Nunca destrói nada: só recusa o push (e quarentena uma CÓPIA se integrity falhar).
async function validateBeforePush(client) {
    const localDb = _localDb();
    const integ = _localIntegrity();
    if (!integ.ok) {
        _quarantineLocal(`integrity_check: ${integ.reason}`);
        return { ok: false, reason: `integrity_check falhou: ${integ.reason}` };
    }
    const localCfg = _countLocal(localDb, 'config');
    const localGs = _countLocal(localDb, 'group_state');
    if (localCfg < 0 || localGs < 0) return { ok: false, reason: 'erro ao ler tabelas locais' };
    if (localCfg === 0) {
        // DB zerado/novo: push enviaria 0 linhas. Recusa por padrão (exige --force).
        return { ok: false, reason: 'db local vazio (config=0) — push recusado; rode --push --force se for intencional' };
    }
    // DB parcial/velho vs nuvem cheia: compara amostras baratas (config + group_state).
    const cloudCfg = await _countCloud(client, 'config');
    const cloudGs = await _countCloud(client, 'group_state');
    if (cloudCfg > 0 && localCfg < Math.ceil(cloudCfg * 0.5)) {
        return { ok: false, reason: `db local suspeito (config local=${localCfg} < 50% da nuvem=${cloudCfg}) — push recusado` };
    }
    if (cloudGs > 0 && localGs === 0) {
        return { ok: false, reason: `db local suspeito (group_state local=0, nuvem=${cloudGs}) — push recusado` };
    }
    return { ok: true };
}

async function backupCloud({ log = console } = {}) {
    if (!isTursoEnabled()) return { ok: false, reason: 'not-configured' };
    const client = getTursoClient();
    await ensureTursoSchema();
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}h${pad(d.getMinutes())}`;
    const file = path.join(dir, `turso-${stamp}.json`);
    const dump = { at: new Date().toISOString(), url: process.env.TURSO_DATABASE_URL, tables: {} };
    for (const table of SYNC_TABLES) {
        try {
            const cap = CAPPED_TABLES[table];
            const rs = cap
                ? await client.execute({ sql: `SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ${cap}`, args: [] })
                : await client.execute({ sql: `SELECT * FROM "${table}"`, args: [] });
            dump.tables[table] = rs.rows || [];
        } catch (e) {
            if (/no such table/i.test(e?.message || '')) { dump.tables[table] = []; continue; }
            throw e;
        }
    }
    fs.writeFileSync(file, JSON.stringify(dump));
    try { log.log(`💾 [turso] backup da nuvem em ${path.basename(file)}`); } catch (_) {}
    return { ok: true, file };
}

function _backupLocalFile(tag) {
    try {
        const fs = require('fs');
        const path = require('path');
        const { dbPath } = require('./db');
        if (!fs.existsSync(dbPath)) return null;
        try { _localDb().pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}h${pad(d.getMinutes())}`;
        const dest = path.join(process.cwd(), 'backups', `bot-pre-${tag}-${stamp}.db`);
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(dbPath, dest);
        return dest;
    } catch (_) { return null; }
}

async function pullFromCloud({ log = console } = {}) {
    if (!isTursoEnabled()) return { ok: false, reason: 'not-configured' };
    if (_syncRunning) return { ok: false, reason: 'busy' };
    _syncRunning = true;
    try {
        const client = getTursoClient();
        await ensureTursoSchema();
        _backupLocalFile('pull'); // sobreescrita local é destrutiva: guarda cópia antes
        const localDb = _localDb();
    let tables = 0, rows = 0;
    for (const table of SYNC_TABLES) {
        if (!_tableExists(localDb, table)) continue;
        const cols = _tableColumns(localDb, table);
        if (!cols.length) continue;
        const cap = CAPPED_TABLES[table];
        let rs;
        try {
            rs = cap
                ? await client.execute({ sql: `SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ${cap}`, args: [] })
                : await client.execute({ sql: `SELECT * FROM "${table}"`, args: [] });
        } catch (e) {
            // tabela pode não existir ainda na nuvem (banco novo) — ignora
            if (/no such table/i.test(e?.message || '')) continue;
            throw e;
        }
        const cloudRows = rs.rows || [];
        // Nuvem vence: apaga local e reinsere. Em tabelas com cap, apaga tudo e fica só com o recente da nuvem.
        const del = localDb.prepare(`DELETE FROM "${table}"`);
        const placeholders = cols.map(() => '?').join(',');
        const quoted = cols.map(c => `"${c}"`).join(',');
        const ins = localDb.prepare(`INSERT OR REPLACE INTO "${table}" (${quoted}) VALUES (${placeholders})`);
        const tx = localDb.transaction((list) => {
            del.run();
            for (const r of list) ins.run(cols.map(c => (r[c] === undefined ? null : r[c])));
        });
        // rs.rows do @libsql/client já vem como objetos {col: val}
        const list = cloudRows.map(r => (r && typeof r === 'object' && !Array.isArray(r)) ? r : {});
        // Para tabelas com cap o SELECT veio DESC — reinsere em ordem ASC para manter rowid coerente
        if (cap) list.reverse();
        tx(list);
        tables++;
        rows += list.length;
    }
    try { localDb.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    _lastPullAt = Date.now();
    _pullOk = true;
    _pullFailed = false;
    try { log.log(`☁️ [turso] PULL ok: ${rows} linhas em ${tables} tabelas (nuvem → local)`); } catch (_) {}
    return { ok: true, tables, rows };
    } catch (e) {
        _pullFailed = true;
        throw e;
    } finally {
        _syncRunning = false;
    }
}

async function pushToCloud({ log = console, force = false, requirePull = true } = {}) {
    if (!isTursoEnabled()) return { ok: false, reason: 'not-configured' };
    // Trava push-até-pull: impede subir lixo na janela de ~25s do boot.
    // Vale para os pushes automáticos (flush/intervalo). Push manual via CLI
    // passa requirePull:false (a validação de sanidade continua valendo).
    if (requirePull && !_pullOk && !force && process.env.TURSO_REQUIRE_PULL !== '0') {
        _lastPushRefused = { at: Date.now(), reason: 'pull-pending' };
        if (!_pullRefusedLogged) {
            _pullRefusedLogged = true;
            try { (log.log || log)(`⏳ [turso] push adiado: aguardando 1º PULL do boot (nuvem vence)`); } catch (_) {}
        }
        _pushPending = true;
        return { ok: false, reason: 'pull-pending' };
    }
    if (_syncRunning) { _pushPending = true; return { ok: false, reason: 'busy' }; }
    _syncRunning = true;
    try {
        const client = getTursoClient();
        await ensureTursoSchema();
        const check = await validateBeforePush(client);
        if (!check.ok && !force) {
            _lastPushRefused = { at: Date.now(), reason: check.reason };
            try { console.error(`🛡️ [turso] PUSH RECUSADO: ${check.reason}`); } catch (_) {}
            return { ok: false, reason: check.reason };
        }
        if (!check.ok && force) {
            try { console.warn(`⚠️ [turso] validação ignorada via --force: ${check.reason}`); } catch (_) {}
        }
        const localDb = _localDb();
        let tables = 0, rows = 0;
        const batch = [];
        const flushBatch = async () => {
            if (!batch.length) return;
            const stmts = batch.splice(0, batch.length);
            await client.batch(stmts);
        };
        for (const table of SYNC_TABLES) {
            if (!_tableExists(localDb, table)) continue;
            const cols = _tableColumns(localDb, table);
            if (!cols.length) continue;
            const cap = CAPPED_TABLES[table];
            const localRows = cap
                ? localDb.prepare(`SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ${cap}`).all().reverse()
                : localDb.prepare(`SELECT * FROM "${table}"`).all();
            if (!localRows.length) { tables++; continue; }
            const quoted = cols.map(c => `"${c}"`).join(',');
            const placeholders = cols.map(() => '?').join(',');
            for (const r of localRows) {
                batch.push({
                    sql: `INSERT OR REPLACE INTO "${table}" (${quoted}) VALUES (${placeholders})`,
                    args: cols.map(c => (r[c] === undefined ? null : r[c])),
                });
                rows++;
                if (batch.length >= 200) await flushBatch();
            }
            tables++;
        }
        await flushBatch();
        _lastPushAt = Date.now();
        _pullRefusedLogged = false;
        try { log.log(`☁️ [turso] PUSH ok: ${rows} linhas em ${tables} tabelas (local → nuvem)`); } catch (_) {}
        return { ok: true, tables, rows };
    } finally {
        _syncRunning = false;
        if (_pushPending) { _pushPending = false; schedulePush(2000); }
    }
}

// Chamado pelos pontos de flush local — não bloqueia o bot.
function schedulePush(delayMs = 5000) {
    if (!isTursoEnabled()) return;
    if (_syncTimer) return; // já há um push agendado; o intervalo cobre o resto
    _syncTimer = setTimeout(async () => {
        _syncTimer = null;
        try { await pushToCloud(); } catch (e) {
            try { console.error('⚠️ [turso] push agendado falhou:', e?.message || e); } catch (_) {}
        }
    }, delayMs);
    try { if (_syncTimer.unref) _syncTimer.unref(); } catch (_) {}
}

function startAutoSync({ onBootPull = true } = {}) {
    if (!isTursoEnabled()) {
        try { console.log('☁️ [turso] desativado (sem TURSO_DATABASE_URL/AUTH_TOKEN) — usando bot.db local'); } catch (_) {}
        return { enabled: false };
    }
    const intervalMs = Math.max(15000, Number(process.env.TURSO_SYNC_INTERVAL_MS) || 60000);
    _pullOk = false;
    _pullFailed = false;
    if (onBootPull && process.env.TURSO_SYNC_ON_BOOT !== '0') {
        // PULL no boot em background (não trava o boot); a nuvem é a verdade.
        // Até ele concluir, todo PUSH é recusado (trava push-até-pull).
        setImmediate(async () => {
            try {
                await pullFromCloud();
                // _configCache em utils.js tem TTL de 1.5s, então expira sozinho.
                // Sem ação extra necessária aqui.
            } catch (e) {
                try { console.error('⚠️ [turso] pull do boot falhou (PUSH bloqueado até próximo pull; segue com bot.db local):', e?.message || e); } catch (_) {}
            }
        });
    } else {
        _pullOk = true; // sync de boot desativado explicitamente: comportamento antigo
    }
    // PUSH periódico (cobre writes que não passaram pelo flushNow)
    const t = setInterval(async () => {
        try { await pushToCloud({ log: { log: () => {} } }); } catch (e) {
            try { console.error('⚠️ [turso] push periódico falhou:', e?.message || e); } catch (_) {}
        }
    }, intervalMs);
    try { if (t.unref) t.unref(); } catch (_) {}
    try { console.log(`☁️ [turso] ativo → ${process.env.TURSO_DATABASE_URL} (pull no boot + push a cada ${Math.round(intervalMs / 1000)}s)`); } catch (_) {}
    return { enabled: true };
}

function status() {
    return { enabled: isTursoEnabled(), lastPullAt: _lastPullAt, lastPushAt: _lastPushAt, pullOk: _pullOk, pullFailed: _pullFailed, lastPushRefused: _lastPushRefused };
}

function markPullOk() { _pullOk = true; _pullFailed = false; }

module.exports = { pullFromCloud, pushToCloud, schedulePush, startAutoSync, status, SYNC_TABLES, backupCloud, validateBeforePush, markPullOk };
