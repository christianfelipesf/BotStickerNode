module.exports = {
    name: 'acelerar',
    aliases: ['fast', 'speed'],
    category: 'mídia',
    description: 'Aumenta a velocidade de um vídeo ou áudio',
    async execute(sock, m, { from, config, mediaHandler, lastBotResponse, GLOBAL_COOLDOWN }) {
        return await mediaHandler.handleMediaCommand(sock, from, m, 'speed', config, lastBotResponse, GLOBAL_COOLDOWN, 2.0);
    }
};
