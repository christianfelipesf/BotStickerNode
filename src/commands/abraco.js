const { fetchInteractionImage } = require('../services/interaction');

module.exports = {
    name: 'abraco',
    aliases: ['abracar', 'abraçar', 'hug', 'abracinho'],
    category: 'interação',
    description: 'Abraça um usuário marcado',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getGroupParticipantName } = utils;
        let current = await react(sock, m, '🤗', lastBotResponse, GLOBAL_COOLDOWN);
        try {
            const ctx = m.message.extendedTextMessage?.contextInfo;
            const mentionedJid = ctx?.mentionedJid?.[0] || null;
            const quotedParticipant = ctx?.participant || null;
            const quotedPush = ctx?.pushName || null;

            let targetJid = mentionedJid || quotedParticipant || null;

            if (!targetJid) {
                await sock.sendMessage(from, { text: '❌ Marque alguém: `!abraco @user` ou responda a mensagem da pessoa com `!abraco`.' }, { quoted: m });
                return current;
            }
            if (targetJid === sender) {
                await sock.sendMessage(from, { text: '🥺 Você se abraçou! Mas que tal abraçar outra pessoa?' }, { quoted: m });
                return current;
            }

            const targetName = isGroup ? await getGroupParticipantName(sock, from, targetJid, quotedPush) : (quotedPush || targetJid.split('@')[0]);
            const senderName = await getGroupParticipantName(sock, from, sender, m.pushName);

            let buffer = null;
            try {
                buffer = await fetchInteractionImage('abraco');
            } catch (e) {
                console.error('❌ [abraco] fetch falhou:', e.message);
            }

            const caption = `🤗 *@${sender.split('@')[0]}* abraçou *@${targetJid.split('@')[0]}*`;
            const mentions = [sender, targetJid];

            if (buffer) {
                await sock.sendMessage(from, { image: buffer, caption, mentions }, { quoted: m });
            } else {
                await sock.sendMessage(from, { text: caption, mentions }, { quoted: m });
            }
            return current;
        } catch (e) {
            console.error('❌ [abraco] erro:', e.message);
            await sock.sendMessage(from, { text: '❌ Falha ao executar !abraco.' }, { quoted: m });
            return current;
        }
    }
};
