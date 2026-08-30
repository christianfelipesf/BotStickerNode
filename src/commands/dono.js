module.exports = {
    name: 'dono',
    aliases: ['owner', 'criador', 'botowner'],
    category: 'geral',
    description: 'Mostra o número do dono/bot conectado',
    async execute(sock, m, { from, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, normalizeJid, getBotName } = utils;
        let current = await react(sock, m, '👑', lastBotResponse, GLOBAL_COOLDOWN);
        try {
            const raw = sock.user?.id || '';
            const jid = normalizeJid(raw);
            const num = jid.split('@')[0] || raw.split(':')[0]?.split('@')[0] || 'desconhecido';
            const contactJid = jid.includes('@') ? jid : `${num}@s.whatsapp.net`;
            const waLink = `https://wa.me/${num}`;

            const text = `👑 *Dono do Bot*\n\n` +
                `📱 *Número:* +${num}\n` +
                `🔗 *Link:* ${waLink}\n` +
                `🤖 *Bot:* ${raw || '—'}`;

            await sock.sendMessage(from, {
                text,
                mentions: [contactJid],
                contextInfo: {
                    mentionedJid: [contactJid]
                }
            }, { quoted: m });

            // opcional: envia contato vCard
            try {
                const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:Dono do Bot\nTEL;type=CELL;type=VOICE;waid=${num}:+${num}\nEND:VCARD`;
                await sock.sendMessage(from, {
                    contacts: { displayName: 'Dono do Bot', contacts: [{ vcard }] }
                }, { quoted: m });
            } catch (_) {}

            return current;
        } catch (e) {
            console.error('❌ [dono] erro:', e.message);
            await sock.sendMessage(from, { text: '❌ Não foi possível obter o número do dono.' }, { quoted: m });
            return current;
        }
    }
};
