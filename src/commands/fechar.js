module.exports = {
    name: 'fechar',
    aliases: ['fechargrupo', 'lock', 'fechargp', 'trancar'],
    description: 'Fecha o grupo (só admins podem enviar mensagens).',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        const admins = await utils.getAdmins(sock, from);
        if (!utils.isUserAdmin(sender, admins)) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }
        if (!utils.isUserAdmin(sock.user.id, admins)) {
            return await sock.sendMessage(from, { text: '❌ Eu preciso ser administrador para fechar o grupo.' }, { quoted: m });
        }

        try {
            await sock.groupSettingUpdate(from, 'announcement');
            if (typeof utils.clearGroupMetadataCache === 'function') utils.clearGroupMetadataCache(from);
        } catch (e) {
            return await sock.sendMessage(from, { text: '❌ Não consegui fechar o grupo.' }, { quoted: m });
        }

        await utils.reactStatus(sock, m, from, true, '🔒', '❌', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, { text: '🔒 Grupo fechado. Só administradores podem enviar mensagens.' }, { quoted: m });
    }
};
