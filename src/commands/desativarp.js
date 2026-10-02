const safeDashboardLog = (...args) => { try { require('../history/store').writeLog(...args); } catch (_) {} };

module.exports = {
    name: 'desativarp',
    category: 'grupos',
    description: 'Desliga o bot no grupo (modo parcial)',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus, deactivatePartial, normalizeJid, canActivateBotAsync, canConfigureBot, canGuardianActAsync } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

        // Dono, sub-dono ou guardião pode desativar. Admin de grupo NÃO desativa.
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
            const msg = '❌ Apenas o dono, sub-donos ou guardiões podem desativar o bot neste grupo.';
            return await sock.sendMessage(from, { text: msg }, { quoted: m });
        }

        const success = deactivatePartial(from);
        try { require('../events/partial').cancelPartialPendingForGroup(from); } catch (_) {}
        console.log(`🟡 [BOT-PARCIAL] desativado em ${from} por @${senderNorm.split('@')[0]}`);
        try {
            const gm = await sock.groupMetadata(from).catch(() => ({ subject: 'Grupo' }));
            safeDashboardLog('action', gm.subject, `🔴 Ativamento Parcial desativado`, senderNorm.split('@')[0], senderNorm.split('@')[0], null, { toJid: from, messageId: m.key.id, senderJid: sender, fromMe: !!m.key.fromMe });
        } catch (_) {}
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
