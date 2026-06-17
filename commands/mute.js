module.exports = {
    name: 'mute',
    aliases: ['mutar'],
    description: 'Muta um membro no grupo (suas mensagens serão apagadas).',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return;

        const admins = await utils.getAdmins(sock, from);
        const isSenderAdmin = admins.includes(sender);

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
            return await sock.sendMessage(from, { text: '❌ Você precisa marcar ou citar alguém para mutar.' }, { quoted: m });
        }

        if (admins.includes(participant)) {
            return await sock.sendMessage(from, { text: '❌ Eu não posso mutar um administrador.' }, { quoted: m });
        }

        const groupData = utils.getGroupData(from);
        if (!groupData.muted) groupData.muted = [];
        
        if (!groupData.muted.includes(participant)) {
            groupData.muted.push(participant);
            utils.setGroupData(from, groupData);
        }

        await utils.react(sock, m, '🔇', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, { text: `🔇 @${participant.split('@')[0]} foi mutado. Suas mensagens serão apagadas.`, mentions: [participant] }, { quoted: m });
    }
};
