const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '../../bot.db');
const legacyDbPath = path.join(__dirname, '../../database.json');
const legacyMsgsPath = path.join(__dirname, '../../messages.json');
const tempDir = path.join(process.cwd(), 'temp');

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('wal_autocheckpoint = 1000');

try {
    const av = Number(db.pragma('auto_vacuum', { simple: true }));
    let vacuumedNow = false;
    if (av === 0) {
        db.pragma('auto_vacuum = INCREMENTAL');
        const beforeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
        db.exec('VACUUM;');
        const afterBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
        const beforeMb = (beforeBytes / 1048576).toFixed(2);
        const afterMb = (afterBytes / 1048576).toFixed(2);
        if (beforeBytes !== afterBytes) {
            console.log(`🧹 [database] VACUUM inicial: ${beforeMb} MB → ${afterMb} MB (auto_vacuum=INCREMENTAL ativo)`);
            vacuumedNow = true;
        }
    }
    const avFinal = Number(db.pragma('auto_vacuum', { simple: true }));
    const pageCount = Number(db.pragma('page_count', { simple: true }));
    const pageSize = Number(db.pragma('page_size', { simple: true }));
    const freelist = Number(db.pragma('freelist_count', { simple: true }));
    const totalBytes = pageCount * pageSize;
    const avLabel = avFinal === 0 ? 'NONE' : avFinal === 1 ? 'FULL' : 'INCREMENTAL';
    const sizeKb = (totalBytes / 1024).toFixed(1);
    const freeKb = (freelist * pageSize / 1024).toFixed(1);
    const note = vacuumedNow ? '' : (avFinal === 2 ? ' (já migrado)' : '');
    console.log(`💾 [database] auto_vacuum=${avLabel}, ${pageCount}×${pageSize}B = ${sizeKb} KB, freelist=${freeKb} KB${note}`);
} catch (e) {
    console.error('[database] VACUUM inicial falhou:', e?.message || e);
}

try {
    const removed = db.prepare(`
        DELETE FROM dashboard_logs
        WHERE message_id IS NULL OR message_id = ''
    `).run();
    if (removed.changes > 0) {
        console.log(`🧹 [database] limpou ${removed.changes} log(s) órffão(s) sem message_id`);
        try { db.pragma('incremental_vacuum(500)'); } catch (_) {}
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    }
} catch (e) {
    console.error('[database] limpeza de órffãos falhou:', e?.message || e);
}

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

    CREATE TABLE IF NOT EXISTS active_groups_partial (
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

    CREATE TABLE IF NOT EXISTS dashboard_groups (
        jid        TEXT PRIMARY KEY,
        enabled    INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dashboard_group_info (
        jid          TEXT PRIMARY KEY,
        subject      TEXT,
        picture_url  TEXT,
        member_count INTEGER NOT NULL DEFAULT 0,
        owner_jid    TEXT,
        desc         TEXT,
        updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS news_groups (
        jid          TEXT PRIMARY KEY,
        enabled      INTEGER NOT NULL DEFAULT 1,
        activated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS news_state (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dashboard_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        type        TEXT NOT NULL,
        grp         TEXT,
        text        TEXT,
        name        TEXT,
        phone       TEXT,
        media_json  TEXT,
        to_jid      TEXT,
        message_id  TEXT,
        sender_jid  TEXT,
        from_me     INTEGER NOT NULL DEFAULT 0,
        hidden      INTEGER NOT NULL DEFAULT 0,
        ephemeral   INTEGER NOT NULL DEFAULT 0,
        quoted_json TEXT,
        reactions   TEXT,
        time_label  TEXT,
        timestamp   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_logs_ts ON dashboard_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_dashboard_logs_to_jid ON dashboard_logs(to_jid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_dashboard_logs_msgid
        ON dashboard_logs(message_id)
        WHERE message_id IS NOT NULL AND message_id != '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_logs_msgid_unique
        ON dashboard_logs(to_jid, message_id, type)
        WHERE message_id IS NOT NULL AND message_id != '';
`);

function checkpointWal() {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
}

module.exports = {
    db,
    dbPath,
    legacyDbPath,
    legacyMsgsPath,
    tempDir,
    checkpointWal
};
