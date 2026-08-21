module.exports = {
    name: 'linkgp',
    aliases: ['linkgrupo', 'linkdogrupo', 'gplink', 'invitegp'],
    category: 'grupos',
    description: 'Mostra o link de convite do grupo',
    async execute(sock, m, { from, isGroup, config }) {
        if (!isGroup) {
            return sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
        }

        try {
            const code = await sock.groupInviteCode(from);
            const link = `https://chat.whatsapp.com/${code}`;
            const { groupMetadataCached, getBotName } = require('../database/utils');
            const meta = await groupMetadataCached(sock, from).catch(() => null);
            const subject = meta?.subject || 'Grupo';
            const botName = getBotName ? getBotName(from, config) : (config?.botName || 'Bot');

            const caption = `*${botName} — ${subject}*\n\n` +
                `╭─── *CONVITE* ───\n` +
                `│ 🔗 ${link}\n` +
                `╰───────────────`;

            let ppUrl = null;
            try { ppUrl = await sock.profilePictureUrl(from, 'image').catch(() => null); } catch (_) {}

            if (ppUrl) {
                return await sock.sendMessage(from, { image: { url: ppUrl }, caption }, { quoted: m });
            } else {
                const path = require('path');
                const fs = require('fs');
                const fallback = path.join(process.cwd(), 'src', 'media', 'logo.png');
                if (fs.existsSync(fallback)) {
                    return await sock.sendMessage(from, { image: { url: fallback }, caption }, { quoted: m });
                }
                return await sock.sendMessage(from, { text: caption }, { quoted: m });
            }
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
