module.exports = {
    name: 'status',
    aliases: ['ping', 'info'],
    category: 'geral',
    description: 'Exibe o status do bot',
    async execute(sock, m, { from, isGroup, startTime, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, readStats, getBotName, formatUptime, isActiveGroup } = utils;
        
        let currentBotResponse = await react(sock, m, 'ℹ️', lastBotResponse, GLOBAL_COOLDOWN);
        const stats = readStats();
        const now = Date.now();
        const botNameForStatus = getBotName(from, config);
        const activeStatus = isGroup ? (isActiveGroup(from) ? '✅ Ativado' : '❌ Desativado') : '✅ Privado';
        
        await sock.sendMessage(from, { 
            text: `🌌 *${botNameForStatus} - Status*\n\n📢 *Estado:* ${activeStatus}\n⏱️ *Uptime:* ${formatUptime((now - startTime) / 1000)}\n🔄 *Reinícios:* ${stats.restarts}\n⌨️ *Comandos:* ${stats.totalCommands}\n💻 *Plataforma:* ${process.platform === 'win32' ? 'Windows' : 'Linux'}` 
        }, { quoted: m });
        
        return currentBotResponse;
    }
};
