module.exports = {
    name: 'antilink',
    description: 'Ativa ou desativa o antilink de grupos de WhatsApp.',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return;

        const admins = await utils.getAdmins(sock, from);
        const isSenderAdmin = utils.isUserAdmin(sender, admins);

        if (!isSenderAdmin) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }

        const groupData = utils.getGroupData(from);
        groupData.antilink = !groupData.antilink;
        utils.setGroupData(from, groupData);

        await utils.react(sock, m, '🛡️', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, { text: `🛡️ Antilink ${groupData.antilink ? 'ATIVADO' : 'DESATIVADO'} para este grupo.` }, { quoted: m });
    }
};
