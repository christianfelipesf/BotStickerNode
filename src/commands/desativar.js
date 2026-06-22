// ============================================================
// !desativar  → Desliga o BOT no grupo (para de responder)
//              NÃO desativa o log de mensagens na dashboard.
//              Para desligar o log de mensagens, use !dashboard.
// ============================================================
module.exports = {
    name: 'desativar',
    category: 'grupos',
    description: 'Desliga o bot no grupo (para de responder comandos). NÃO desativa o log na dashboard.',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, deactivateGroup, getAdmins, isUserAdmin, normalizeJid, canAdminControl } = utils;
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

        const success = deactivateGroup(from);
        const ts = new Date().toLocaleString('pt-BR');
        console.log(`\n🔴 [BOT-DESATIVAR] ──────────────────────────────────`);
        console.log(`   Grupo    : ${from}`);
        console.log(`   Por      : @${senderNorm.split('@')[0]} ${isBotOwner ? '(dono do bot)' : '(admin do grupo)'}`);
        console.log(`   Quando   : ${ts}`);
        console.log(`   Resultado: ${success ? 'BOT DESLIGADO neste grupo' : 'já estava desativado'}`);
        console.log(`   Obs.     : comandos não serão respondidos. O log no painel continua independente.`);
        console.log(`─────────────────────────────────────────────────────\n`);
        return await react(sock, m, success ? '🔴' : '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};