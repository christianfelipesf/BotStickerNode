module.exports = {
    name: 'revelar',
    aliases: ['r', 'rv', 'i'],
    category: 'mídia',
    description: 'Revela mensagem de visualização única',
    async execute(sock, m, { from, config, mediaHandler, lastBotResponse, GLOBAL_COOLDOWN }) {
        return await mediaHandler.handleMediaCommand(sock, from, m, 'reveal', config, lastBotResponse, GLOBAL_COOLDOWN);
    }
};
