module.exports = {
    name: 's',
    aliases: ['sticker', 'f', 'figurinha'],
    category: 'mídia',
    description: 'Cria um sticker a partir de imagem ou vídeo',
    async execute(sock, m, { from, config, mediaHandler, lastBotResponse, GLOBAL_COOLDOWN }) {
        return await mediaHandler.handleMediaCommand(sock, from, m, 'sticker', config, lastBotResponse, GLOBAL_COOLDOWN);
    }
};
