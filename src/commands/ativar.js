// ============================================================
// !ativar  → Liga o BOT no grupo (passa a responder comandos)
//           NÃO ativa o log de mensagens na dashboard.
//           Para ligar o log de mensagens, use !dashboard.
// ============================================================
module.exports = {
    name: 'ativar',
    category: 'grupos',
    description: 'Liga o bot no grupo (responde comandos). NÃO ativa o log na dashboard.',
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
        const ts = new Date().toLocaleString('pt-BR');
        console.log(`\n🟢 [BOT-ATIVAR] ─────────────────────────────────────`);
        console.log(`   Grupo    : ${from}`);
        console.log(`   Por      : @${senderNorm.split('@')[0]} ${isBotOwner ? '(dono do bot)' : '(admin do grupo)'}`);
        console.log(`   Quando   : ${ts}`);
        console.log(`   Resultado: ${success ? 'BOT LIGADO neste grupo' : 'já estava ativo'}`);
        console.log(`   Obs.     : comandos serão respondidos. Para ver logs no painel, use !dashboard.`);
        console.log(`─────────────────────────────────────────────────────\n`);
        return await react(sock, m, success ? '🟢' : '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};