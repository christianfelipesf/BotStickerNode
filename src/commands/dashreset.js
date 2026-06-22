const dashboard = require('../dashboard/dashboard');

module.exports = {
    name: 'dashreset',
    aliases: ['resetdash'],
    category: 'admin',
    description: 'Reseta o dashboard (logs, mídias, cache) e ajusta o limite para 500. Apenas dono do bot.',
    async execute(sock, m, { sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, normalizeJid } = utils;

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

        if (!isBotOwner) {
            return await sock.sendMessage(m.key.remoteJid,
                { text: '❌ Apenas o dono do bot pode resetar o dashboard.' },
                { quoted: m });
        }

        const result = dashboard.resetDashboard();
        console.log(`🧹 [DASHBOARD] resetado por @${senderNorm.split('@')[0]} — removidos=${result.removedLogs} limite=${result.newLimit}`);
        return await react(sock, m, '🧹', lastBotResponse, GLOBAL_COOLDOWN);
    }
};