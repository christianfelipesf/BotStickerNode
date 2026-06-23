module.exports = {
    name: 'desativarp',
    category: 'grupos',
    description: 'Desliga o bot no grupo (modo parcial)',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus, deactivatePartial, getAdmins, isUserAdmin, normalizeJid, canAdminControl } = utils;
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
                ? '❌ Apenas o dono do bot ou admins do grupo podem desativar o bot.'
                : '❌ Apenas o dono do bot pode desativar o bot neste grupo.';
            return await sock.sendMessage(from, { text: msg }, { quoted: m });
        }

        const success = deactivatePartial(from);
        console.log(`🟡 [BOT-PARCIAL] desativado em ${from} por @${senderNorm.split('@')[0]}`);
        if (!success) {
            return await react(sock, m, '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
        }
        try {
            await sock.sendMessage(from, { text: '🟡 *Ativamento Parcial* desativado neste grupo.' }, { quoted: m });
        } catch (err) {
            console.error('❌ [BOT-PARCIAL] falhou ao enviar mensagem de desativamento:', err.message);
            return await react(sock, m, '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
        }
        return await reactStatus(sock, m, from, true, '🔴', '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
