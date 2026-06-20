module.exports = {
    name: 'toimg',
    aliases: ['tovideo', 'pramidia'],
    category: 'mídia',
    description: 'Converte sticker para imagem ou vídeo',
    async execute(sock, m, { from, config, mediaHandler, lastBotResponse, GLOBAL_COOLDOWN }) {
        return await mediaHandler.handleMediaCommand(sock, from, m, 'toimg', config, lastBotResponse, GLOBAL_COOLDOWN);
    }
};
