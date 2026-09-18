module.exports = {
    name: 'antilink',
    description: 'Ativa ou desativa o antilink do grupo (padrão ativado; só age se o bot for admin).',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        const admins = await utils.getAdmins(sock, from);
        const isSenderAdmin = utils.isUserAdmin(sender, admins);

        if (!isSenderAdmin) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }

        const groupData = utils.getGroupData(from);
        groupData.antilink = !groupData.antilink;
        utils.setGroupData(from, groupData);

        await utils.react(sock, m, '🛡️', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, { text: `🛡️ Antilink ${groupData.antilink ? 'ativado' : 'desativado'} para este grupo.` }, { quoted: m });
    }
};
