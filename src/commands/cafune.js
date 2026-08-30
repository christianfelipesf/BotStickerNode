const { fetchInteractionImage } = require('../services/interaction');

module.exports = {
    name: 'cafune',
    aliases: ['cafune', 'carinho', 'pat', 'fazercafune'],
    category: 'interação',
    description: 'Faz cafuné em um usuário',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getGroupParticipantName } = utils;
        let current = await react(sock, m, '🥰', lastBotResponse, GLOBAL_COOLDOWN);
        try {
            const ctx = m.message.extendedTextMessage?.contextInfo;
            const mentionedJid = ctx?.mentionedJid?.[0] || null;
            const quotedParticipant = ctx?.participant || null;
            const quotedPush = ctx?.pushName || null;
            let targetJid = mentionedJid || quotedParticipant || null;
            if (!targetJid) {
                await sock.sendMessage(from, { text: '❌ Marque alguém: `!cafune @user` ou responda a mensagem.' }, { quoted: m });
                return current;
            }
            const caption = `🥰 *@${sender.split('@')[0]}* fez cafuné em *@${targetJid.split('@')[0]}*`;
            const mentions = [sender, targetJid];
            let buffer = null;
            try { buffer = await fetchInteractionImage('cafune'); } catch (e) { console.error('❌ [cafune] fetch falhou:', e.message); }
            if (buffer) await sock.sendMessage(from, { image: buffer, caption, mentions }, { quoted: m });
            else await sock.sendMessage(from, { text: caption, mentions }, { quoted: m });
            return current;
        } catch (e) {
            console.error('❌ [cafune] erro:', e.message);
            await sock.sendMessage(from, { text: '❌ Falha ao executar !cafune.' }, { quoted: m });
            return current;
        }
    }
};
