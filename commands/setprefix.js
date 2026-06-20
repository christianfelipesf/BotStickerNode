module.exports = {
    name: 'setprefix',
    aliases: ['prefixo', 'prefix', 'definirprefixo'],
    category: 'config',
    description: 'Altera o prefixo dos comandos do bot',
    async execute(sock, m, { from, sender, args, config, utils, ai, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, writeConfig, readConfig } = utils;
        const { setupAI } = ai;
        
        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }
        
        const newPrefix = (args[0] || '').trim();
        if (!newPrefix) {
            await sock.sendMessage(from, { text: `❌ Use: ${config.prefix}setprefix <novo prefixo>` }, { quoted: m });
            return lastBotResponse;
        }
        
        // WhatsApp prefix is usually a single character (e.g. !, ., /, #)
        const prefixChar = newPrefix[0];
        
        config.prefix = prefixChar;
        writeConfig(config);
        
        // Refresh local config and AI
        const newConfig = readConfig();
        setupAI(newConfig);
        
        let currentBotResponse = await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
        await sock.sendMessage(from, { text: `✅ Prefixo global atualizado para: *${prefixChar}*` }, { quoted: m });
        return currentBotResponse;
    }
};
