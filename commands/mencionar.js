module.exports = {
    name: 'mencionar',
    aliases: ['todos', 'tagall'],
    category: 'grupos',
    description: 'Marca todos os membros do grupo',
    async execute(sock, m, { from, isGroup, sender, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        
        const meta = await sock.groupMetadata(from);
        if (!meta.participants.find(p => p.id === sender)?.admin && !m.key.fromMe) {
            return await react(sock, m, '🚫', lastBotResponse, GLOBAL_COOLDOWN);
        }
        
        let currentBotResponse = await react(sock, m, '📢', lastBotResponse, GLOBAL_COOLDOWN);
        await sock.sendMessage(from, { 
            text: fullArgsText || '📢 Atenção!', 
            mentions: meta.participants.map(p => p.id) 
        }, { quoted: m });
        
        return currentBotResponse;
    }
};
