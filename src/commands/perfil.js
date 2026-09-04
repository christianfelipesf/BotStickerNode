module.exports = {
    name: 'perfil',
    aliases: ['pp', 'profile'],
    category: 'geral',
    description: 'Exibe a foto de perfil de um usuário',
    async execute(sock, m, { from, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName } = utils;
        let currentBotResponse = await react(sock, m, '👤', lastBotResponse, GLOBAL_COOLDOWN);

        try {
            const qInfo = m.message.extendedTextMessage?.contextInfo;
            const target = qInfo?.mentionedJid?.[0] || qInfo?.participant || sender;
            const ppUrl = await sock.profilePictureUrl(target, 'image').catch(() => 'https://web.whatsapp.com/img/default-user-icon.jpg');

            const botName = getBotName(from, config || {});
            const isLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid');
            const toDisplay = (jid, fallbackName) => {
                if (isLid(jid)) return fallbackName && !['usuario','usuário'].includes(String(fallbackName).trim().toLowerCase()) ? String(fallbackName).trim().slice(0,30) : 'Usuário';
                const num = String(jid||'').split('@')[0].split(':')[0];
                return /^\d{8,15}$/.test(num) ? `@${num}` : (fallbackName ? String(fallbackName).trim().slice(0,30) : 'Usuário');
            };
            // tenta pegar nome via pushName se disponível no m
            const pushName = m.pushName || null;
            const quotedName = m.message?.extendedTextMessage?.contextInfo?.pushName || null;
            const targetDisplay = toDisplay(target, quotedName || null);
            const senderDisplay = toDisplay(sender, pushName || null);
            const isSelf = String(target||'').split('@')[0] === String(sender||'').split('@')[0];

            // visual igual ao de mídia convertida (╭─── / │ / ╰───────────────)
            const caption = isSelf
                ? `╭─── *👤 PERFIL* ───\n` +
                  `│ 👤 *Usuário:* ${targetDisplay}\n` +
                  `│ 🤖 *Por:* ${botName}\n` +
                  `╰───────────────`
                : `╭─── *👤 PERFIL* ───\n` +
                  `│ 👤 *Usuário:* ${targetDisplay}\n` +
                  `│ 👥 *Solicitado por:* ${senderDisplay}\n` +
                  `│ 🤖 *Por:* ${botName}\n` +
                  `╰───────────────`;

            const mentions = isSelf ? [target] : [target, sender];

            await sock.sendMessage(from, {
                image: { url: ppUrl },
                caption,
                mentions
            }, { quoted: m });
        } catch (e) {
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
