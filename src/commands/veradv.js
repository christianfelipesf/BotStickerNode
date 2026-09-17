module.exports = {
    name: 'veradv',
    aliases: ['warns', 'veradvertencia', 'veradvertencias', 'advlist'],
    description: 'Consulta advertências: marque/cite alguém ou use sem alvo para ver o top.',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, utils }) {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        const admins = await utils.getAdmins(sock, from);
        if (!utils.isUserAdmin(sender, admins)) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }

        let participant = '';
        if (m.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            participant = m.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (m.message.extendedTextMessage?.contextInfo?.participant) {
            participant = m.message.extendedTextMessage.contextInfo.participant;
        }

        const gd = utils.getGroupData(from) || {};
        const warnings = (gd.warnings && typeof gd.warnings === 'object') ? gd.warnings : {};

        if (participant) {
            const count = Number(warnings[participant]) || 0;
            if (count <= 0) {
                return await sock.sendMessage(from, { text: `✅ @${participant.split('@')[0]} não tem advertências.`, mentions: [participant] }, { quoted: m });
            }
            return await sock.sendMessage(from, { text: `⚠️ @${participant.split('@')[0]} tem ${count}/3 advertências.`, mentions: [participant] }, { quoted: m });
        }

        const entries = Object.entries(warnings).filter(([, c]) => (Number(c) || 0) > 0).sort((a, b) => b[1] - a[1]).slice(0, 20);
        if (entries.length === 0) {
            return await sock.sendMessage(from, { text: '✅ Ninguém tem advertências neste grupo.' }, { quoted: m });
        }
        const lines = entries.map(([jid, c], i) => `${i + 1}. @${String(jid).split('@')[0]} — ${c}/3`);
        return await sock.sendMessage(from, { text: `⚠️ *Advertências ativas*\n${lines.join('\n')}`, mentions: entries.map(([jid]) => jid) }, { quoted: m });
    }
};
