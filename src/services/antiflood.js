const { getAntifloodConfig } = require('../database/utils');

const floodMap = new Map(); // groupJid -> Map(userJid -> { times: number[], lastWarn: number })
const WARN_COOLDOWN_MS = 15000;
const CLEAN_INTERVAL_MS = 60 * 1000;

function getUserEntry(groupJid, userJid) {
    let groupMap = floodMap.get(groupJid);
    if (!groupMap) {
        groupMap = new Map();
        floodMap.set(groupJid, groupMap);
    }
    let entry = groupMap.get(userJid);
    if (!entry) {
        entry = { times: [], lastWarn: 0 };
        groupMap.set(userJid, entry);
    }
    return entry;
}

function pruneTimes(entry, windowMs, now) {
    const cutoff = now - windowMs;
    while (entry.times.length && entry.times[0] < cutoff) entry.times.shift();
}

setInterval(() => {
    const now = Date.now();
    for (const [gid, gmap] of floodMap.entries()) {
        for (const [uid, entry] of gmap.entries()) {
            pruneTimes(entry, 60000, now);
            if (entry.times.length === 0 && now - entry.lastWarn > 60000) gmap.delete(uid);
        }
        if (gmap.size === 0) floodMap.delete(gid);
    }
}, CLEAN_INTERVAL_MS).unref();

async function enforceAntiflood(sock, m, from, sender, isSenderAdmin, isBotAdmin) {
    try {
        const cfg = getAntifloodConfig(from);
        if (!cfg.enabled) return null;
        if (isSenderAdmin && !cfg.includeAdmins) return null;
        if (!isBotAdmin) return null;

        const now = Date.now();
        const windowMs = cfg.windowSecs * 1000;
        const maxMsgs = cfg.maxMsgs;

        const entry = getUserEntry(from, sender);
        entry.times.push(now);
        pruneTimes(entry, windowMs, now);

        if (entry.times.length > maxMsgs) {
            // flood detected
            try { await sock.sendMessage(from, { delete: m.key }); } catch (_) {}
            // evita spam de aviso
            if (now - entry.lastWarn > WARN_COOLDOWN_MS) {
                entry.lastWarn = now;
                try {
                    await sock.sendMessage(from, {
                        text: `🚨 *Antiflood:* @${sender.split('@')[0]} enviou ${entry.times.length} mensagens em ${cfg.windowSecs}s (limite ${maxMsgs}). Mensagem apagada.`,
                        mentions: [sender]
                    });
                } catch (_) {}
            }
            // mantém apenas últimos eventos para não bloquear permanentemente
            // remove 1 para dar chance após aviso
            entry.times.splice(0, 1);
            return 'antiflood';
        }
        return null;
    } catch (_) {
        return null;
    }
}

function clearAntifloodState(jid) {
    if (jid) floodMap.delete(jid);
    else floodMap.clear();
}

module.exports = { enforceAntiflood, clearAntifloodState };
