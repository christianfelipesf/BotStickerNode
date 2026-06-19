module.exports = {
    name: 'desmute',
    aliases: ['desmutar'],
    description: 'Desmuta um membro no grupo (remove da lista em RAM).',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return;

        const adminsRaw = await utils.getAdmins(sock, from);
        const admins = adminsRaw.map(p => p.id);

        const senderNorm = utils.normalizeJid(sender);
        const isSenderAdmin = admins.some(id => utils.normalizeJid(id) === senderNorm);

        if (!isSenderAdmin) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }

        let participant = '';
        if (m.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            participant = m.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (m.message.extendedTextMessage?.contextInfo?.participant) {
            participant = m.message.extendedTextMessage.contextInfo.participant;
        }

        if (!participant) {
            return await sock.sendMessage(from, { text: '❌ Você precisa marcar ou citar alguém para desmutar.' }, { quoted: m });
        }

        const wasMuted = utils.isMuted(from, participant);
        utils.removeMuted(from, participant);

        await utils.react(sock, m, '🔊', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, {
            text: wasMuted
                ? `🔊 @${participant.split('@')[0]} foi desmutado.`
                : `ℹ️ @${participant.split('@')[0]} não estava na lista de mute.`,
            mentions: [participant]
        }, { quoted: m });
    }
};