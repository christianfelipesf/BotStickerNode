const subSessions = require('../services/subSessions');

module.exports = {
    name: 'logoff',
    aliases: ['sair', 'logout'],
    category: 'admin',
    description: 'Encerra a sub-sessão do usuário (limpa credenciais)',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        const ownerJid = sender;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(ownerJid);
        const isBotOwner = m.key.fromMe === true || ownerJid === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '🚪', lastBotResponse, GLOBAL_COOLDOWN);

        const ok = await subSessions.logout(ownerJid);
        if (ok) {
            await sock.sendMessage(from, {
                text: '🚪 *Sub-sessão encerrada.*\nCredenciais removidas. Use !login para criar uma nova.'
            }, { quoted: m });
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } else {
            await sock.sendMessage(from, {
                text: '⚠️ Nenhuma sub-sessão ativa para você.'
            }, { quoted: m });
            currentBotResponse = await react(sock, m, '⚠️', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
