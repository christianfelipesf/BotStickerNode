module.exports = {
    name: 'linkgp',
    aliases: ['linkgrupo', 'linkdogrupo', 'gplink', 'invitegp'],
    category: 'grupos',
    description: 'Mostra o link de convite do grupo',
    async execute(sock, m, { from, isGroup }) {
        if (!isGroup) {
            return sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
        }

        try {
            const code = await sock.groupInviteCode(from);
            const link = `https://chat.whatsapp.com/${code}`;
            const meta = await sock.groupMetadata(from).catch(() => null);
            const subject = meta?.subject || 'Grupo';
            return sock.sendMessage(from, { text: `🔗 *Link do grupo* — *${subject}*\n\n${link}` }, { quoted: m });
        } catch (e) {
            const msg = String(e?.message || e || '').toLowerCase();
            const isAdminError = msg.includes('not-authorized') || msg.includes('forbidden') || msg.includes('401') || msg.includes('403') || msg.includes('admin');
            if (isAdminError) {
                return sock.sendMessage(from, { text: '❌ Não consegui pegar o link. O bot precisa ser *admin* do grupo para gerar o convite.' }, { quoted: m });
            }
            console.error('[linkgp] erro:', e?.message || e);
            return sock.sendMessage(from, { text: '❌ Erro ao obter o link do grupo. Tente novamente mais tarde.' }, { quoted: m });
        }
    }
};
