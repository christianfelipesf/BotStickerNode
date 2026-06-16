module.exports = {
    name: 'ativar',
    category: 'grupos',
    description: 'Ativa o bot no grupo',
    async execute(sock, m, { from, isGroup, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, activateGroup } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        const success = activateGroup(from);
        return await react(sock, m, success ? '🟢' : '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
