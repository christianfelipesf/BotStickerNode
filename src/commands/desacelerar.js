module.exports = {
    name: 'desacelerar',
    aliases: ['slow'],
    category: 'mídia',
    description: 'Diminui a velocidade de um vídeo ou áudio',
    async execute(sock, m, { from, config, mediaHandler, lastBotResponse, GLOBAL_COOLDOWN }) {
        return await mediaHandler.handleMediaCommand(sock, from, m, 'speed', config, lastBotResponse, GLOBAL_COOLDOWN, 0.5);
    }
};
