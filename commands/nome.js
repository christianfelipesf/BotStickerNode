module.exports = {
    name: 'nome',
    aliases: ['setnome', 'botname'],
    category: 'grupos',
    description: 'Altera o nome do bot neste grupo',
    async execute(sock, m, { from, isGroup, fullArgsText, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, setGroupData } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        if (!fullArgsText) {
            await sock.sendMessage(from, { text: `❌ Use: ${config.prefix}nome <novo nome>` }, { quoted: m });
            return lastBotResponse;
        }
        
        setGroupData(from, { botName: fullArgsText });
        let currentBotResponse = await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
        await sock.sendMessage(from, { text: `✅ Nome do bot alterado para: *${fullArgsText}* neste grupo!` }, { quoted: m });
        
        return currentBotResponse;
    }
};
