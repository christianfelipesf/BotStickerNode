module.exports = {
    name: 'revelar',
    aliases: ['r', 'rv', 'i'],
    category: 'mídia',
    description: 'Revela mensagem de visualização única',
    async execute(sock, m, { from, isGroup, sender, config, utils, mediaHandler, lastBotResponse, GLOBAL_COOLDOWN }) {
        // Restrição opcional por grupo (desativada por padrão): só admins revelam.
        // Ativada via !revelaradmin (admin do grupo).
        if (isGroup && utils) {
            try {
                const gd = utils.getGroupData(from) || {};
                if (gd.revealAdminOnly && !m?.key?.fromMe) {
                    const admins = await utils.getAdmins(sock, from);
                    if (!utils.isUserAdmin(sender, admins)) {
                        return await sock.sendMessage(from, { text: '🔒 Apenas *admins* podem revelar mídia de visualização única neste grupo.' }, { quoted: m });
                    }
                }
            } catch (_) { /* em caso de erro, mantém liberado (padrão) */ }
        }
        const senderJid = m.key.participant || m.key.remoteJid;
        const pushName = m.pushName || 'Usuário';
        return await mediaHandler.handleMediaCommand(sock, from, m, 'reveal', config, lastBotResponse, GLOBAL_COOLDOWN, { senderName: pushName, senderJid: senderJid || sender });
    }
};
