module.exports = {
    name: 'togif',
    aliases: ['gif'],
    category: 'mídia',
    description: 'Converte vídeo ou sticker animado para GIF',
    async execute(sock, m, { from, config, mediaHandler, lastBotResponse, GLOBAL_COOLDOWN }) {
        return await mediaHandler.handleMediaCommand(sock, from, m, 'togif', config, lastBotResponse, GLOBAL_COOLDOWN);
    }
};