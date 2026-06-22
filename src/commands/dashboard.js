// ============================================================
// !dashboard  → Liga/desliga o LOG DE MENSAGENS deste grupo
//              no painel de monitoramento (dashboard web).
//              É INDEPENDENTE do !ativar / !desativar:
//                * !ativar       = bot responde comandos
//                * !desativar    = bot para de responder comandos
//                * !dashboard    = painel web mostra logs das msgs
//              Os dois podem estar ligados ao mesmo tempo.
// ============================================================
const dashboard = require('../dashboard/dashboard');

module.exports = {
    name: 'dashboard',
    aliases: ['dash', 'painel'],
    category: 'admin',
    description: 'Liga/desliga o LOG DE MENSAGENS deste grupo no painel web (independente de !ativar).',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN, config }) {
        const { react, isDashboardEnabled, setDashboardEnabled, getAdmins, isUserAdmin, normalizeJid, canAdminControl, isActiveGroup } = utils;

        if (!isGroup) {
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
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
                ? '❌ Apenas o dono do bot ou admins do grupo podem ativar/desativar o log no dashboard.'
                : '❌ Apenas o dono do bot pode ativar/desativar o log no dashboard.';
            return await sock.sendMessage(from, { text: msg }, { quoted: m });
        }

        const current = isDashboardEnabled(from);
        const next = !current;
        const ok = setDashboardEnabled(from, next);

        if (!ok) {
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        try { dashboard.pushGroupsSnapshot(); } catch (_) {}

        let subject = 'grupo';
        try {
            const meta = await sock.groupMetadata(from);
            if (meta?.subject) subject = meta.subject;
        } catch (_) {}

        const ts = new Date().toLocaleString('pt-BR');
        const botAtivo = isActiveGroup(from);
        console.log(`\n📊 [DASHBOARD-LOG] ──────────────────────────────────`);
        console.log(`   Grupo     : ${subject} (${from})`);
        console.log(`   Por       : @${senderNorm.split('@')[0]} ${isBotOwner ? '(dono do bot)' : '(admin do grupo)'}`);
        console.log(`   Quando    : ${ts}`);
        console.log(`   Resultado : LOG DE MENSAGENS ${next ? 'LIGADO' : 'DESLIGADO'} no painel`);
        console.log(`   Bot ativo : ${botAtivo ? 'SIM (vai aparecer também os comandos e respostas do bot)' : 'NÃO (só mensagens do grupo)'}`);
        console.log(`   Obs.      : !dashboard NÃO liga/desliga o bot — use !ativar / !desativar para isso.`);
        console.log(`──────────────────────────────────────────────────────\n`);

        return await react(sock, m, next ? '🟢' : '🔴', lastBotResponse, GLOBAL_COOLDOWN);
    }
};