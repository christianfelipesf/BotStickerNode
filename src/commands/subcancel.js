const subSessions = require('../services/subSessions');

module.exports = {
    name: 'subcancel',
    aliases: ['logincancel', 'cancelarlogin'],
    category: 'admin',
    description: 'Cancela o login da sub-sessão que está na fila/aguardando o principal',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '🚫', lastBotResponse, GLOBAL_COOLDOWN);

        const removed = subSessions.cancelQueuedLogin(sender);
        const active = subSessions.getSession(sender);
        if (removed) {
            await sock.sendMessage(from, {
                text: '🚫 *Login cancelado.*\nVocê saiu da fila. Use `!login` quando quiser tentar de novo (com o principal já 🟢).'
            }, { quoted: m });
        } else if (active?.connecting) {
            await sock.sendMessage(from, {
                text: 'ℹ️ Seu login já está gerando QR/código — aguarde.\nSe travou, use `!subclean` e depois `!login`.'
            }, { quoted: m });
        } else {
            await sock.sendMessage(from, {
                text: '⚠️ Você não está na fila de login.'
            }, { quoted: m });
        }

        currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        return currentBotResponse;
    }
};
