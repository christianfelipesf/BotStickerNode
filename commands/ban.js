module.exports = {
    name: 'ban',
    description: 'Bane um membro do grupo.',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return;

        const admins = await utils.getAdmins(sock, from);
        const isSenderAdmin = admins.includes(sender);
        const isBotAdmin = admins.includes(sock.user.id.split(':')[0] + '@s.whatsapp.net');

        if (!isSenderAdmin) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }

        if (!isBotAdmin) {
            return await sock.sendMessage(from, { text: '❌ Eu preciso ser administrador para banir membros.' }, { quoted: m });
        }

        let participant = '';
        if (m.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            participant = m.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (m.message.extendedTextMessage?.contextInfo?.participant) {
            participant = m.message.extendedTextMessage.contextInfo.participant;
        }

        if (!participant) {
            return await sock.sendMessage(from, { text: '❌ Você precisa marcar ou citar alguém para banir.' }, { quoted: m });
        }

        if (admins.includes(participant)) {
            return await sock.sendMessage(from, { text: '❌ Eu não posso banir um administrador.' }, { quoted: m });
        }

        await sock.groupParticipantsUpdate(from, [participant], 'remove');
        await utils.react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, { text: '👋 Usuário banido com sucesso.' }, { quoted: m });
    }
};
