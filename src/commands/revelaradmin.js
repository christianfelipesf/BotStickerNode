module.exports = {
    name: 'revelaradmin',
    aliases: ['revelaradm', 'rvadm', 'revelar-admin', 'soadmrevelar'],
    description: 'Restringe o !revelar de mídia de visualização única só para admins (desativado por padrão).',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        const admins = await utils.getAdmins(sock, from);
        if (!utils.isUserAdmin(sender, admins)) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }

        const sub = String(args?.[0] || '').toLowerCase();
        const gd = utils.getGroupData(from) || {};
        const cur = !!gd.revealAdminOnly;

        if (['ver', 'status', 'info', 'config'].includes(sub)) {
            return await sock.sendMessage(from, { text: `🔓 *Revelar view-once*\n\n• Restrito a admins: ${cur ? '🟢 ativado (só admins revelam)' : '🔴 desativado (todos revelam)'}\n\n💡 *Uso:*\n• \`!revelaradmin\` — liga/desliga\n• \`!revelaradmin on\` — só admins revelam\n• \`!revelaradmin off\` — todos revelam` }, { quoted: m });
        }

        let next = !cur;
        if (['on', 'on!', 'ativar', 'ligar', 'sim', '1'].includes(sub)) next = true;
        else if (['off', 'desativar', 'desligar', 'nao', 'não', '0'].includes(sub)) next = false;

        if (next === cur) {
            return await sock.sendMessage(from, { text: `ℹ️ Revelar view-once já está ${cur ? 'restrito a *admins* 🟢' : 'liberado para *todos* 🔴'}.` }, { quoted: m });
        }

        utils.setGroupData(from, { revealAdminOnly: next });

        await utils.react(sock, m, '🔓', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, { text: next ? '🔓✅ *Revelar view-once restrito a admins.*\nApenas administradores poderão usar o !revelar neste grupo.' : '🔓❌ *Revelar view-once liberado.*\nTodos os membros podem usar o !revelar neste grupo.' }, { quoted: m });
    }
};
