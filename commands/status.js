module.exports = {
    name: 'status',
    aliases: ['ping', 'info'],
    category: 'geral',
    description: 'Exibe o status do bot',
    async execute(sock, m, { from, startTime, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, readStats, getBotName, formatUptime } = utils;
        
        let currentBotResponse = await react(sock, m, 'ℹ️', lastBotResponse, GLOBAL_COOLDOWN);
        const stats = readStats();
        const now = Date.now();
        const botNameForStatus = getBotName(from, config);
        
        await sock.sendMessage(from, { 
            text: `🌌 *${botNameForStatus} - Status*\n⏱️ Uptime: ${formatUptime((now - startTime) / 1000)}\n🔄 Reinícios: ${stats.restarts}\n⌨️ Comandos: ${stats.totalCommands}\n💻 Platform: ${process.platform === 'win32' ? 'Windows' : 'Linux'}` 
        }, { quoted: m });
        
        return currentBotResponse;
    }
};
