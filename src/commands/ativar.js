module.exports = {
    name: 'ativar',
    category: 'grupos',
    description: 'Liga o bot no grupo',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, activateGroup, getAdmins, isUserAdmin, normalizeJid, canAdminControl } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

        let allowed = isBotOwner;
        if (!allowed && canAdminControl()) {
            try {
                const adminsRaw = await getAdmins(sock, from);
                allowed = isUserAdmin(sender, adminsRaw);
            } catch (_) {}
        }

        if (!allowed) {
            const msg = canAdminControl()
                ? '❌ Apenas o dono do bot ou admins do grupo podem ativar o bot.'
                : '❌ Apenas o dono do bot pode ativar o bot neste grupo.';
            return await sock.sendMessage(from, { text: msg }, { quoted: m });
        }

        const success = activateGroup(from);
        console.log(`🟢 [BOT] ativado em ${from} por @${senderNorm.split('@')[0]}`);
        return await react(sock, m, success ? '🟢' : '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};