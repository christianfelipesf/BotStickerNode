module.exports = {
    name: 'set',
    category: 'config',
    description: 'Altera uma configuração do bot',
    async execute(sock, m, { from, sender, args, config, utils, ai, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, writeConfig, readConfig } = utils;
        const { setupAI } = ai;
        
        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }
        
        const p = args[0]; 
        const v = args.slice(1).join(' ');
        
        if (!p) {
            await sock.sendMessage(from, { text: `❌ Use: ${config.prefix}set <parâmetro> <valor>` }, { quoted: m });
            return lastBotResponse;
        }
        
        if (config[p] !== undefined || p === 'prefix') {
            if (!v) {
                await sock.sendMessage(from, { text: `📝 *${p}* atual: ${config[p]}` }, { quoted: m });
                return lastBotResponse;
            }
            
            if (p === 'prefix') config.prefix = v.trim()[0] || '!';
            else if (p === 'showLogoInMenu' || p === 'voiceEffects' || p === 'dashboardEnabled') config[p] = v.toLowerCase() === 'true';
            else if (p === 'summaryLimit' || p === 'clearDefaultLimit' || p === 'dashboardPort' || p === 'dashboardMaxLogs' || p === 'dashboardHistoryHours' || p === 'newsPollIntervalMs' || p === 'newsSendDelayMs' || p === 'newsMaxPerCycle' || p === 'newsMaxRetries' || p === 'newsRetryBaseDelayMs' || p === 'dashboardTrimIntervalMs') config[p] = parseInt(v, 10);
            else config[p] = v;
            
            writeConfig(config);
            // Refresh local config and AI
            const newConfig = readConfig();
            setupAI(newConfig);
            
            let currentBotResponse = await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, { text: `✅ *${p}* atualizado!` }, { quoted: m });
            return currentBotResponse;
        } else {
            await sock.sendMessage(from, { text: `❌ Parâmetro inválido!` }, { quoted: m });
            return lastBotResponse;
        }
    }
};
