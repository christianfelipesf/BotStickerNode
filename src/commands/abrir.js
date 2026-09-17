module.exports = {
    name: 'abrir',
    aliases: ['abrirgrupo', 'unlock', 'abrirgp', 'destrancar'],
    description: 'Abre o grupo (todos podem enviar mensagens).',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        const admins = await utils.getAdmins(sock, from);
        if (!utils.isUserAdmin(sender, admins)) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }
        if (!utils.isUserAdmin(sock.user.id, admins)) {
            return await sock.sendMessage(from, { text: '❌ Eu preciso ser administrador para abrir o grupo.' }, { quoted: m });
        }

        try {
            await sock.groupSettingUpdate(from, 'not_announcement');
            if (typeof utils.clearGroupMetadataCache === 'function') utils.clearGroupMetadataCache(from);
        } catch (e) {
            return await sock.sendMessage(from, { text: '❌ Não consegui abrir o grupo.' }, { quoted: m });
        }

        await utils.reactStatus(sock, m, from, true, '🔓', '❌', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, { text: '🔓 Grupo aberto. Todos podem enviar mensagens.' }, { quoted: m });
    }
};
