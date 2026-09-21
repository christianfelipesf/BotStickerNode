const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function phoneFromJid(jid) {
    const s = String(jid || '');
    // Só aceita número real de @s.whatsapp.net — nunca LID
    if (!s.endsWith('@s.whatsapp.net')) return null;
    const digits = s.split('@')[0].split(':')[0].replace(/\D/g, '');
    return digits.length >= 8 ? digits : null;
}

function isBadName(n) {
    if (!n) return true;
    const s = String(n).trim();
    if (!s) return true;
    if (/^(usu[aá]rio)?$/i.test(s)) return true;
    // Nunca mostrar JID
    if (s.includes('@') || /s\.whatsapp\.net/i.test(s) || /@lid/i.test(s)) return true;
    if (/^\d+:\d+$/.test(s)) return true;
    return false;
}

module.exports = {
    name: 'nuke',
    aliases: ['bomba', 'atomic'],
    category: 'geral',
    description: 'Troll secreto: finge explodir o grupo (não bane ninguém)',
    async execute(sock, m, { from, isGroup, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, groupMetadataCached, getAdmins, getGroupParticipantName } = utils;

        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        let currentBotResponse = lastBotResponse;
        try { currentBotResponse = await react(sock, m, '☢️', lastBotResponse, GLOBAL_COOLDOWN); } catch (_) {}

        // 1ª mensagem
        await sock.sendMessage(from, { text: '☢️ *Bomba atômica iniciada...*' }, { quoted: m });

        await sleep(2500);

        // Coleta admins + total de membros (só leitura, não bane ninguém)
        let adminNames = [];
        let memberCount = 0;
        try {
            const meta = await groupMetadataCached(sock, from).catch(() => null);
            const parts = Array.isArray(meta?.participants) ? meta.participants : [];
            memberCount = parts.length;

            let adminsRaw = [];
            try { adminsRaw = await getAdmins(sock, from); } catch (_) { adminsRaw = []; }
            // Fallback se getAdmins falhar: filtra direto do metadata
            if (!adminsRaw || adminsRaw.length === 0) {
                adminsRaw = parts
                    .filter(p => p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin)
                    .map(p => ({ id: p.id, jid: p.jid, lid: p.lid, name: p.name, notify: p.notify }));
            }

            const byId = new Map();
            for (const p of parts) {
                for (const k of [p.id, p.jid, p.lid, p.phoneNumber]) {
                    if (k) byId.set(String(k), p);
                }
            }

            for (const a of adminsRaw) {
                const jid = a.id || a.jid || a.lid;
                if (!jid) continue;
                let name = null;
                // 1) notify/name que já veio no metadata (sem marcar)
                const mp = byId.get(String(jid));
                const rawName = a.name || a.notify || mp?.notify || mp?.name || mp?.verifiedName || null;
                if (!isBadName(rawName)) {
                    name = String(rawName).trim().slice(0, 30);
                }
                // 2) resolve via cache/activity (nunca expõe menção sozinho)
                if (!name) {
                    try {
                        const resolved = await getGroupParticipantName(sock, from, jid, null);
                        if (!isBadName(resolved)) {
                            name = String(resolved).trim().slice(0, 30);
                        }
                    } catch (_) {}
                }
                // 3) fallback: número real (phoneNumber ou @s.whatsapp.net).
                // Nunca mostra JID/@lid — se não houver número, pula o admin.
                if (!name) {
                    const phone = phoneFromJid(mp?.phoneNumber) || phoneFromJid(mp?.id) || phoneFromJid(mp?.jid) || phoneFromJid(jid);
                    if (phone) name = phone;
                    else continue;
                }
                adminNames.push(name);
            }
        } catch (_) {}

        if (adminNames.length === 0) adminNames = ['Admins'];
        if (!memberCount || memberCount <= 0) memberCount = 256;

        // 2ª mensagem — SEM campo mentions para não marcar ninguém
        const text =
            `💥 *${adminNames.join(', ')}, banidos.*\n` +
            `🚫 *${memberCount} pessoas banidas, grupo fechado.*`;

        await sock.sendMessage(from, { text }, { quoted: m });

        return currentBotResponse;
    }
};
