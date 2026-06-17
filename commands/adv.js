module.exports = {
    name: 'adv',
    aliases: ['advertencia'],
    description: 'Dá uma advertência a um membro. 3 advertências resultam em banimento.',
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
            return await sock.sendMessage(from, { text: '❌ Você precisa marcar ou citar alguém para dar uma advertência.' }, { quoted: m });
        }

        if (admins.includes(participant)) {
            return await sock.sendMessage(from, { text: '❌ Eu não posso advertir um administrador.' }, { quoted: m });
        }

        const groupData = utils.getGroupData(from);
        if (!groupData.warnings) groupData.warnings = {};
        
        groupData.warnings[participant] = (groupData.warnings[participant] || 0) + 1;
        const count = groupData.warnings[participant];

        if (count >= 3) {
            const isBotAdmin = admins.includes(sock.user.id.split(':')[0] + '@s.whatsapp.net');
            if (isBotAdmin) {
                await sock.groupParticipantsUpdate(from, [participant], 'remove');
                delete groupData.warnings[participant];
                utils.setGroupData(from, groupData);
                return await sock.sendMessage(from, { text: `🚫 @${participant.split('@')[0]} atingiu 3 advertências e foi banido.`, mentions: [participant] });
            } else {
                return await sock.sendMessage(from, { text: `⚠️ @${participant.split('@')[0]} atingiu 3 advertências, mas não sou admin para banir.`, mentions: [participant] });
            }
        }

        utils.setGroupData(from, groupData);
        await utils.react(sock, m, '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, { text: `⚠️ @${participant.split('@')[0]} recebeu uma advertência. (${count}/3)`, mentions: [participant] }, { quoted: m });
    }
};
