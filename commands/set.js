module.exports = {
    name: 'set',
    category: 'config',
    description: 'Altera uma configuração do bot',
    async execute(sock, m, { from, args, config, utils, ai, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, writeConfig, readConfig } = utils;
        const { setupAI } = ai;
        
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
            else config[p] = (p === 'showLogoInMenu' || p === 'voiceEffects' || p === 'dashboardEnabled') ? v.toLowerCase() === 'true' : (p === 'summaryLimit' ? parseInt(v) : v);
            
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
