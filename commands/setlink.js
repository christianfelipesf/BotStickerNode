const { getGroupLink, setGroupLink, getAdmins, isUserAdmin } = require('../utils');

module.exports = {
    name: 'setlink',
    aliases: ['setlinkgrupo', 'setlinkg', 'definirlink'],
    category: 'utilidades',
    description: 'Define o link do grupo para ser usado pelo !divulgar',
    async execute(sock, m, { from, isGroup, fullArgsText, sender }) {
        if (!isGroup) {
            return sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
        }

        const admins = await getAdmins(sock, from);
        if (!isUserAdmin(sender, admins)) {
            return sock.sendMessage(from, { text: '❌ Apenas admins podem definir o link.' }, { quoted: m });
        }

        const link = (fullArgsText || '').trim();
        if (!link) {
            return sock.sendMessage(from, { text: '❌ Use: !setlink https://chat.whatsapp.com/...' }, { quoted: m });
        }

        if (!/^https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(link)) {
            return sock.sendMessage(from, { text: '❌ Link inválido. Use um link de convite do WhatsApp (https://chat.whatsapp.com/...)' }, { quoted: m });
        }

        setGroupLink(link);
        return sock.sendMessage(from, { text: '✅ Link do grupo salvo. Use !divulgar para iniciar.' }, { quoted: m });
    }
};
