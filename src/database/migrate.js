const fs = require('fs');
const path = require('path');
const { db, legacyDbPath, legacyMsgsPath } = require('./db');

function migrateLegacyUnifiedDB() {
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
        const json = { config: { ...old.config || {} }, stats: { restarts: 0, totalCommands: 0, ...(old.stats || {}) }, groups: {} };
        const oldSettings = old.groups?.settings || {};
        for (const [jid, s] of Object.entries(oldSettings)) {
            const fixed = {};
            if (s.botName) fixed.botName = s.botName;
            if (s.menuImage) fixed.menuImage = s.menuImage;
            if (Object.keys(fixed).length > 0) json.groups[jid] = fixed;
        }
        const tmp = legacyDbPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(json, null, 2));
        fs.renameSync(tmp, legacyDbPath);

        const agInsert = db.prepare('INSERT OR REPLACE INTO active_groups (jid, activated_at) VALUES (?, ?)');
        const oldActive = Array.isArray(old.groups?.activeGroups) ? old.groups.activeGroups : [];
        const now = Date.now();
        for (const jid of oldActive) agInsert.run(jid, now);

        const ins = db.prepare('INSERT OR REPLACE INTO group_state (jid, muted, warnings, antilink, activity) VALUES (?, ?, ?, ?, ?)');
        for (const [jid, s] of Object.entries(oldSettings)) {
            ins.run(jid, JSON.stringify(Array.isArray(s.muted) ? s.muted : []), JSON.stringify(s.warnings && typeof s.warnings === 'object' ? s.warnings : {}), s.antilink ? 1 : 0, JSON.stringify({}));
        }
        const activityData = old.groups?.activity?.data || {};
        for (const [jid, members] of Object.entries(activityData)) {
            const existing = db.prepare('SELECT activity FROM group_state WHERE jid = ?').get(jid);
            const cur = existing ? JSON.parse(existing.activity) : {};
            for (const [sender, info] of Object.entries(members || {})) cur[sender] = info;
            db.prepare('INSERT OR REPLACE INTO group_state (jid, muted, warnings, antilink, activity) VALUES (?, ?, ?, ?, ?)').run(jid, '[]', '{}', 0, JSON.stringify(cur));
        }
        try { db.prepare('DELETE FROM kv WHERE key = ?').run('bot_state_v1'); } catch (_) {}
        console.log('✅ Migração do banco unificado concluída');
        return true;
    } catch (e) {
        console.error('❌ Falha ao migrar banco unificado:', e.message);
        return false;
    }
}

function migrateLegacyMessagesJson() {
    if (!fs.existsSync(legacyMsgsPath)) return;
    try {
        const parsed = JSON.parse(fs.readFileSync(legacyMsgsPath, 'utf8'));
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

function migrateLegacyActiveGroups() {
    if (!fs.existsSync(legacyDbPath)) return;
    let json;
    try {
        json = JSON.parse(fs.readFileSync(legacyDbPath, 'utf8'));
    } catch (e) {
        return;
    }
    const oldActive = Array.isArray(json.groups?.activeGroups) ? json.groups.activeGroups : [];
    if (oldActive.length > 0 && !json.stats._activeGroupsMigrated) {
        const agInsert = db.prepare('INSERT OR IGNORE INTO active_groups (jid, activated_at) VALUES (?, ?)');
        const now = Date.now();
        let count = 0;
        for (const jid of oldActive) { if (agInsert.run(jid, now).changes > 0) count++; }
        console.log(`✅ Migração: ${count} activeGroups JSON -> bot.db`);
    }
    const oldSettings = (json.groups?.settings && typeof json.groups.settings === 'object') ? json.groups.settings : null;
    if (oldSettings && !json.stats._settingsMigrated) {
        const gsInsert = db.prepare('INSERT OR REPLACE INTO group_state (jid, muted, warnings, antilink, activity) VALUES (?, ?, ?, ?, ?)');
        const newGroups = {};
        for (const [jid, s] of Object.entries(oldSettings)) {
            gsInsert.run(jid, JSON.stringify(Array.isArray(s.muted) ? s.muted : []), JSON.stringify(s.warnings && typeof s.warnings === 'object' ? s.warnings : {}), s.antilink ? 1 : 0, JSON.stringify({}));
            const fixed = {};
            if (s.botName) fixed.botName = s.botName;
            if (s.menuImage) fixed.menuImage = s.menuImage;
            if (Object.keys(fixed).length > 0) newGroups[jid] = fixed;
        }
        json.groups = newGroups;
        json.stats._settingsMigrated = Date.now();
        json.stats._activeGroupsMigrated = Date.now();
        const tmp = legacyDbPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(json, null, 2));
        fs.renameSync(tmp, legacyDbPath);
        console.log('✅ Migração: settings JSON -> group_state (SQLite) + groups JSON');
    } else if (oldActive.length > 0 && !json.stats._activeGroupsMigrated) {
        delete json.groups.activeGroups;
        if (json.groups.settings) delete json.groups.settings;
        if (Object.keys(json.groups).length === 0) delete json.groups;
        json.stats._activeGroupsMigrated = Date.now();
        const tmp = legacyDbPath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(json, null, 2));
        fs.renameSync(tmp, legacyDbPath);
    }
}

module.exports = {
    migrateLegacyUnifiedDB,
    migrateLegacyMessagesJson,
    migrateLegacyActiveGroups
};
