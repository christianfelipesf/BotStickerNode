module.exports = {
    name: 'desativar',
    category: 'grupos',
    description: 'Desativa o bot no grupo',
    async execute(sock, m, { from, isGroup, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, deactivateGroup } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        const success = deactivateGroup(from);
        return await react(sock, m, success ? '🔴' : '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
