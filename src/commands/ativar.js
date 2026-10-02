module.exports = {
    name: 'ativar',
    category: 'grupos',
    description: 'Liga o bot no grupo',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus, activateGroup, normalizeJid, canActivateBotAsync, canConfigureBot, canGuardianActAsync } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

        // Dono, sub-dono ou guardião pode ativar. Admin de grupo NÃO ativa.
        let allowed = isBotOwner;
        if (!allowed) {
            try {
                if (typeof canActivateBotAsync === 'function') {
                    if ((await canActivateBotAsync(sock, m, sender, from)).ok) allowed = true;
                } else if (typeof canConfigureBot === 'function') {
                    if (canConfigureBot(sock, m, sender, from).ok) allowed = true;
                }
                if (!allowed && typeof canGuardianActAsync === 'function') {
                    if ((await canGuardianActAsync(sock, m, sender, from)).ok) allowed = true;
                }
            } catch (_) {}
        }

        if (!allowed) {
            const msg = '❌ Apenas o dono, sub-donos ou guardiões podem usar este comando.';
            return await sock.sendMessage(from, { text: msg }, { quoted: m });
        }

        const success = activateGroup(from);
        console.log(`🟢 [BOT] ativado em ${from} por @${senderNorm.split('@')[0]}`);
        return await reactStatus(sock, m, from, success, '🟢', '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};