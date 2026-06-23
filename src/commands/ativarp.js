module.exports = {
    name: 'ativarp',
    category: 'grupos',
    description: 'Liga o bot no grupo em modo parcial (apenas comandos de mídia; espera 10s antes de responder)',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, activatePartial, getPartialWaitMs, getAdmins, isUserAdmin, normalizeJid, canAdminControl } = utils;
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

        const success = activatePartial(from);
        const waitSec = Math.round(getPartialWaitMs() / 1000);
        console.log(`🟡 [BOT-PARCIAL] ativado em ${from} por @${senderNorm.split('@')[0]} (wait=${waitSec}s)`);
        await sock.sendMessage(from, {
            text: `🟡 *Ativamento Parcial* ativado!\n\n⏱️ Tempo de espera: ${waitSec}s\n🎬 Comandos permitidos: mídia (!s, !play, !toimg, !tts, !download, etc.)\n🚫 Comandos admin ficarão mudos.\n\n💡 O bot só responde se nenhum outro bot reagir em ${waitSec}s.\n\nPara voltar ao modo total, use ${utils.readConfig ? `${utils.readConfig().prefix}` : '!'}ativar.`
        }, { quoted: m });
        return await react(sock, m, success ? '🟡' : '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
