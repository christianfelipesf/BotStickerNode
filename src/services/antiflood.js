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
        entry = { times: [], lastWarn: 0, latest: 0, hits: 0, lastHit: 0 };
        groupMap.set(userJid, entry);
    }
    return entry;
}

function pruneTimes(entry, windowMs, refTime) {
    const cutoff = refTime - windowMs;
    while (entry.times.length && entry.times[0] < cutoff) entry.times.shift();
}

// Horário real da mensagem (ms). Antes usava Date.now() do processamento:
// sob carga cada !s leva segundos p/ processar e 10 floods "rápidos" se
// espalhavam em 30s de processamento — nunca estouravam a janela.
// Com o timestamp da mensagem, rajada é rajada independente do atraso.
function getMsgTimeMs(m, now) {
    try {
        let t = m?.messageTimestamp;
        if (t && typeof t === 'object' && typeof t.low === 'number') t = t.low;
        t = Number(t);
        if (!Number.isFinite(t) || t <= 0) return now;
        if (t > 1e12) t = Math.floor(t / 1000); // veio em ms -> s
        const ms = t * 1000;
        if (ms > now + 60000) return now; // relógio futuro: ignora
        if (ms < now - 10 * 60 * 1000) return now; // muito antiga: conta como agora
        return ms;
    } catch (_) { return now; }
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
        const t = getMsgTimeMs(m, now);
        if (t > (entry.latest || 0)) entry.latest = t;
        entry.times.push(t);
        entry.times.sort((a, b) => a - b);
        pruneTimes(entry, windowMs, entry.latest);

        if (entry.times.length > maxMsgs) {
            // flood detected
            try {
                await sock.sendMessage(from, { delete: m.key });
            } catch (delErr) {
                // Antes era catch silencioso: parecia "não apagou nada" sem rastro.
                console.error(`❌ [antiflood] falha ao apagar msg ${m?.key?.id || '?'} de ${sender} em ${from}: ${delErr?.message || delErr}`);
            }
            // evita spam de aviso
            if (now - entry.lastWarn > WARN_COOLDOWN_MS) {
                entry.lastWarn = now;
                try {
                    await sock.sendMessage(from, {
                        text: `🚨 *Antiflood:* @${sender.split('@')[0]} enviou ${entry.times.length} mensagens em ${cfg.windowSecs}s (limite ${maxMsgs}). Mensagem apagada.`,
                        mentions: [sender]
                    });
                } catch (warnErr) {
                    console.error(`❌ [antiflood] falha ao avisar flood em ${from}: ${warnErr?.message || warnErr}`);
                }
            }
            entry.hits += 1;
            entry.lastHit = now;
            // mantém apenas últimos eventos para não bloquear permanentemente
            // remove 1 para dar chance após aviso
            entry.times.splice(0, 1);
            return 'antiflood';
        }
        return null;
    } catch (e) {
        console.error(`❌ [antiflood] erro inesperado em ${from}: ${e?.message || e}`);
        return null;
    }
}

function getAntifloodStats(jid) {
    // p/ !antiflood status mostrar que está agindo (hits + último)
    try {
        const gmap = floodMap.get(jid);
        if (!gmap || gmap.size === 0) return { tracked: 0, hits: 0, lastHit: 0 };
        let hits = 0;
        let lastHit = 0;
        for (const entry of gmap.values()) {
            hits += entry.hits || 0;
            if ((entry.lastHit || 0) > lastHit) lastHit = entry.lastHit;
        }
        return { tracked: gmap.size, hits, lastHit };
    } catch (_) { return { tracked: 0, hits: 0, lastHit: 0 }; }
}

function clearAntifloodState(jid) {
    if (jid) floodMap.delete(jid);
    else floodMap.clear();
}

module.exports = { enforceAntiflood, clearAntifloodState, getAntifloodStats };
