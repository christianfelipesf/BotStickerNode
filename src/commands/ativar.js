module.exports = {
    name: 'ativar',
    category: 'grupos',
    description: 'Liga o bot no grupo',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus, activateGroup, normalizeJid } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        const success = activateGroup(from);
        console.log(`🟢 [BOT] ativado em ${from} por @${senderNorm.split('@')[0]}`);
        return await reactStatus(sock, m, from, success, '🟢', '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};