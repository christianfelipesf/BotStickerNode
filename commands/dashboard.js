const dashboard = require('../lib/dashboard');

module.exports = {
    name: 'dashboard',
    aliases: ['dash', 'painel'],
    category: 'admin',
    description: 'Ativa/desativa o painel de monitoramento (dashboard) deste grupo',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN, config }) {
        const { react, getAdmins, isDashboardEnabled, setDashboardEnabled } = utils;

        if (!isGroup) {
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

        if (!isBotOwner) {
            try {
                const adminsRaw = await getAdmins(sock, from);
                const senderUser = senderNorm.split('@')[0];
                const isSenderAdmin = adminsRaw.some(p => {
                    const candidates = [p.id, p.jid, p.lid].filter(Boolean).map(j => utils.normalizeJid(j));
                    return candidates.some(c => c.split('@')[0] === senderUser);
                });
                if (!isSenderAdmin) {
                    return await sock.sendMessage(from, { text: '❌ Apenas admins ou o dono do bot podem usar este comando.' }, { quoted: m });
                }
            } catch (e) {
                return await sock.sendMessage(from, { text: '❌ Não foi possível verificar admins. Tente novamente.' }, { quoted: m });
            }
        }

        const current = isDashboardEnabled(from);
        const next = !current;
        const ok = setDashboardEnabled(from, next);

        if (!ok) {
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        try { dashboard.pushGroupsSnapshot(); } catch (_) {}

        const statusText = next
            ? '🟢 *Dashboard ATIVADA* para este grupo.\nMensagens daqui aparecerão no painel.'
            : '🔴 *Dashboard DESATIVADA* para este grupo.\nMensagens daqui não aparecerão mais no painel.';

        let resp = await react(sock, m, next ? '🟢' : '🔴', lastBotResponse, GLOBAL_COOLDOWN);
        await sock.sendMessage(from, { text: statusText }, { quoted: m });
        return resp;
    }
};

