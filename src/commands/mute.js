module.exports = {
    name: 'mute',
    aliases: ['mutar'],
    description: 'Muta um membro no grupo (suas mensagens serão apagadas). Funciona apenas enquanto o bot estiver ligado (em RAM).',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return;

        const adminsRaw = await utils.getAdmins(sock, from);
        const isSenderAdmin = utils.isUserAdmin(sender, adminsRaw);

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

        const isTargetAdmin = utils.isUserAdmin(participant, adminsRaw);
        if (isTargetAdmin) {
            return await sock.sendMessage(from, { text: '❌ Eu não posso mutar um administrador.' }, { quoted: m });
        }

        const isBotAdmin = await utils.botIsAdmin(sock, from);

        const added = utils.addMuted(from, participant);

        await utils.react(sock, m, '🔇', lastBotResponse, GLOBAL_COOLDOWN);

        if (!isBotAdmin) {
            return await sock.sendMessage(from, {
                text: `⚠️ @${participant.split('@')[0]} foi adicionado à lista de mute, mas *eu não sou administrador* deste grupo, portanto não consigo apagar as mensagens dele. Promova o bot a admin para que o mute funcione.`,
                mentions: [participant]
            }, { quoted: m });
        }

        return await sock.sendMessage(from, {
            text: added
                ? `🔇 @${participant.split('@')[0]} foi mutado. As mensagens dele serão apagadas enquanto o bot estiver ligado.`
                : `ℹ️ @${participant.split('@')[0]} já estava mutado.`,
            mentions: [participant]
        }, { quoted: m });
    }
};