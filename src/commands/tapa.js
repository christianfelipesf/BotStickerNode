const { fetchInteractionImage } = require('../services/interaction');

module.exports = {
    name: 'tapa',
    aliases: ['slap', 'tapar'],
    category: 'interação',
    description: 'Dá um tapa em um usuário',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        let current = await react(sock, m, '👋', lastBotResponse, GLOBAL_COOLDOWN);
        try {
            const ctx = m.message.extendedTextMessage?.contextInfo;
            const mentionedJid = ctx?.mentionedJid?.[0] || null;
            const quotedParticipant = ctx?.participant || null;
            let targetJid = mentionedJid || quotedParticipant || null;
            if (!targetJid) {
                await sock.sendMessage(from, { text: '❌ Marque alguém: `!tapa @user` ou responda a mensagem.' }, { quoted: m });
                return current;
            }
            const caption = `👋 *@${sender.split('@')[0]}* deu um tapa em *@${targetJid.split('@')[0]}*`;
            const mentions = [sender, targetJid];
            let buffer = null;
            try { buffer = await fetchInteractionImage('tapa'); } catch (e) { console.error('❌ [tapa] fetch falhou:', e.message); }
            if (buffer) await sock.sendMessage(from, { image: buffer, caption, mentions }, { quoted: m });
            else await sock.sendMessage(from, { text: caption, mentions }, { quoted: m });
            return current;
        } catch (e) {
            console.error('❌ [tapa] erro:', e.message);
            await sock.sendMessage(from, { text: '❌ Falha ao executar !tapa.' }, { quoted: m });
            return current;
        }
    }
};
