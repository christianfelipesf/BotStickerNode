require('dotenv').config();

let _client = null;

function isTursoEnabled() {
    return !!((process.env.TURSO_DATABASE_URL || '').trim() && (process.env.TURSO_AUTH_TOKEN || '').trim());
}

function getTursoClient() {
    if (_client) return _client;
    if (!isTursoEnabled()) return null;
    const { createClient } = require('@libsql/client');
    _client = createClient({
        url: process.env.TURSO_DATABASE_URL.trim(),
        authToken: process.env.TURSO_AUTH_TOKEN.trim(),
    });
    return _client;
}

const SCHEMA_SQL = `
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
        activity  TEXT NOT NULL DEFAULT '{}',
        bot_name  TEXT,
        menu_image TEXT,
        prefix    TEXT,
        sticker_pack TEXT,
        sticker_author TEXT,
        theme     TEXT,
        extra     TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stats (
        key   TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE IF NOT EXISTS dashboard_visits (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        username    TEXT,
        ip          TEXT,
        user_agent  TEXT,
        timestamp   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_visits_ts ON dashboard_visits(timestamp);
    CREATE TABLE IF NOT EXISTS group_blacklist (
        group_jid TEXT NOT NULL,
        user_jid  TEXT NOT NULL,
        added_by  TEXT,
        added_at  INTEGER NOT NULL,
        PRIMARY KEY (group_jid, user_jid)
    );
    CREATE INDEX IF NOT EXISTS idx_group_blacklist_group ON group_blacklist(group_jid);
    CREATE TABLE IF NOT EXISTS feedback (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL CHECK(kind IN ('bug','sugestao')),
        text        TEXT NOT NULL,
        sender_jid  TEXT,
        sender_name TEXT,
        group_jid   TEXT,
        created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_kind_created ON feedback(kind, created_at DESC);
    CREATE TABLE IF NOT EXISTS antiflood_config (
        jid             TEXT PRIMARY KEY,
        enabled         INTEGER NOT NULL DEFAULT 0,
        include_admins  INTEGER NOT NULL DEFAULT 0,
        max_msgs        INTEGER NOT NULL DEFAULT 5,
        window_secs     INTEGER NOT NULL DEFAULT 8,
        updated_at      INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_allowed (
        phone      TEXT PRIMARY KEY,
        added_by   TEXT,
        added_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_msg_stats (
        jid   TEXT NOT NULL,
        day   TEXT NOT NULL,
        hour  INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (jid, day, hour)
    );
    CREATE INDEX IF NOT EXISTS idx_group_msg_stats_jid_day ON group_msg_stats(jid, day);
    CREATE TABLE IF NOT EXISTS group_modlog (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        jid       TEXT NOT NULL,
        kind      TEXT NOT NULL,
        timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_group_modlog_jid_ts ON group_modlog(jid, timestamp);
    CREATE INDEX IF NOT EXISTS idx_group_modlog_jid_kind_ts ON group_modlog(jid, kind, timestamp);
    CREATE TABLE IF NOT EXISTS rank_monthly_history (
        jid        TEXT NOT NULL,
        month      TEXT NOT NULL,
        total      INTEGER NOT NULL DEFAULT 0,
        data       TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (jid, month)
    );
    CREATE TABLE IF NOT EXISTS pessoas (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        nome       TEXT NOT NULL,
        nome_norm  TEXT NOT NULL UNIQUE,
        nascimento TEXT,
        cidade     TEXT,
        descricao  TEXT,
        status     TEXT,
        hobby      TEXT,
        pix        TEXT,
        instagram  TEXT,
        linkedin   TEXT,
        foto_path  TEXT,
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pessoas_cidade ON pessoas(cidade);
    CREATE INDEX IF NOT EXISTS idx_pessoas_nascimento ON pessoas(nascimento);
`;

async function ensureTursoSchema() {
    const client = getTursoClient();
    if (!client) throw new Error('Turso não configurado (TURSO_DATABASE_URL/AUTH_TOKEN ausentes)');
    const statements = SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean);
    for (const sql of statements) {
        await client.execute(sql);
    }
    // índices únicos parciais do dashboard_logs (suportados no Turso/libsql)
    try { await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_logs_msgid_unique ON dashboard_logs(to_jid, message_id, type) WHERE message_id IS NOT NULL AND message_id != ''`); } catch (_) {}
    try { await client.execute(`CREATE INDEX IF NOT EXISTS idx_dashboard_logs_msgid ON dashboard_logs(message_id) WHERE message_id IS NOT NULL AND message_id != ''`); } catch (_) {}
}

async function pingTurso() {
    const client = getTursoClient();
    if (!client) return { ok: false, reason: 'not-configured' };
    try {
        const rs = await client.execute('SELECT 1 AS ok');
        return { ok: true, rows: rs.rows };
    } catch (e) {
        return { ok: false, reason: e?.message || String(e) };
    }
}

module.exports = { isTursoEnabled, getTursoClient, ensureTursoSchema, pingTurso, SCHEMA_SQL };
