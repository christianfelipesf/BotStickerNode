const { fetchInteractionImage } = require('../services/interaction');

module.exports = {
    name: 'beijar',
    aliases: ['kiss', 'beijo', 'beijos', 'beijinho', 'beijao', 'beijão', 'kisar', 'bjo'],
    category: 'interação',
    description: 'Beija um usuário marcado',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getGroupParticipantName } = utils;
        let current = await react(sock, m, '💋', lastBotResponse, GLOBAL_COOLDOWN);
        try {
            const ctx = m.message.extendedTextMessage?.contextInfo;
            const mentionedJid = ctx?.mentionedJid?.[0] || null;
            const quotedParticipant = ctx?.participant || null;
            const quotedPush = ctx?.pushName || null;

            let targetJid = mentionedJid || quotedParticipant || null;
            let targetName = null;

            if (!targetJid) {
                await sock.sendMessage(from, { text: '❌ Marque alguém: `!beijar @user` ou responda a mensagem da pessoa com `!beijar`.' }, { quoted: m });
                return current;
            }
            if (targetJid === sender) {
                await sock.sendMessage(from, { text: '😅 Você não pode beijar a si mesmo! Marque outra pessoa.' }, { quoted: m });
                return current;
            }

            if (isGroup) {
                targetName = await getGroupParticipantName(sock, from, targetJid, quotedPush);
            } else {
                targetName = quotedPush || targetJid.split('@')[0];
            }
            const senderName = await getGroupParticipantName(sock, from, sender, m.pushName);

            let buffer = null;
            try {
                buffer = await fetchInteractionImage('beijar');
            } catch (e) {
                console.error('❌ [beijar] fetch falhou:', e.message);
            }

            const caption = `💋 *@${sender.split('@')[0]}* beijou *@${targetJid.split('@')[0]}*`;
            const mentions = [sender, targetJid];

            if (buffer) {
                await sock.sendMessage(from, { image: buffer, caption, mentions }, { quoted: m });
            } else {
                await sock.sendMessage(from, { text: caption, mentions }, { quoted: m });
            }
            return current;
        } catch (e) {
            console.error('❌ [beijar] erro:', e.message);
            await sock.sendMessage(from, { text: '❌ Falha ao executar !beijar.' }, { quoted: m });
            return current;
        }
    }
};
