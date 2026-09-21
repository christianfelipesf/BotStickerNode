module.exports = {
    name: 'ativar',
    category: 'grupos',
    description: 'Liga o bot no grupo',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus, activateGroup, normalizeJid, canAdminControl, getAdmins, isUserAdmin } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

        // Mesma regra do !ativarp: admin do grupo pode ativar se canAdminControl()
        // (antes só o dono conseguia voltar ao modo total — trava operacional).
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
                : '❌ Apenas o dono do bot pode usar este comando.';
            return await sock.sendMessage(from, { text: msg }, { quoted: m });
        }

        const success = activateGroup(from);
        console.log(`🟢 [BOT] ativado em ${from} por @${senderNorm.split('@')[0]}`);
        return await reactStatus(sock, m, from, success, '🟢', '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};