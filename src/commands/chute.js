const { fetchInteractionImage } = require('../services/interaction');
module.exports = {
    name: 'chute',
    aliases: ['chutar', 'kick', 'chutou'],
    category: 'interação',
    description: 'Dá um chute em um usuário',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        let cur = await react(sock, m, '🦶', lastBotResponse, GLOBAL_COOLDOWN);
        const ctx = m.message.extendedTextMessage?.contextInfo;
        let targetJid = ctx?.mentionedJid?.[0] || ctx?.participant || null;
        if (!targetJid) { await sock.sendMessage(from, { text: '❌ Marque alguém: `!chute @user` ou responda a mensagem.' }, { quoted: m }); return cur; }
        const caption = `🦶 *@${sender.split('@')[0]}* chutou *@${targetJid.split('@')[0]}*`;
        const mentions = [sender, targetJid];
        let buf = null; try { buf = await fetchInteractionImage('chute'); } catch (e) { console.error('❌ [chute] fetch falhou:', e.message); }
        if (buf) await sock.sendMessage(from, { image: buf, caption, mentions }, { quoted: m }); else await sock.sendMessage(from, { text: caption, mentions }, { quoted: m });
        return cur;
    }
};
