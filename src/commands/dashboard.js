const dashboard = require('../dashboard/dashboard');

module.exports = {
    name: 'dashboard',
    aliases: ['dash', 'painel'],
    category: 'admin',
    description: 'Ativa/desativa o painel de monitoramento (dashboard) deste grupo',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN, config }) {
        const { react, isDashboardEnabled, setDashboardEnabled, getAdmins, isUserAdmin, normalizeJid, canAdminControl } = utils;

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
                ? '❌ Apenas o dono do bot ou admins do grupo podem ativar/desativar o dashboard.'
                : '❌ Apenas o dono do bot pode ativar/desativar o dashboard.';
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
        if (next) {
            console.log(`📊 [DASHBOARD] ATIVADA em "${subject}" (${from}) por @${senderNorm.split('@')[0]} às ${ts}`);
        } else {
            console.log(`📊 [DASHBOARD] DESATIVADA em "${subject}" (${from}) por @${senderNorm.split('@')[0]} às ${ts}`);
        }

        return await react(sock, m, next ? '🟢' : '🔴', lastBotResponse, GLOBAL_COOLDOWN);
    }
};