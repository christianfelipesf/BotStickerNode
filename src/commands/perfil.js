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
            const targetNum = String(target || '').split('@')[0].split(':')[0] || 'usuário';
            const senderNum = String(sender || '').split('@')[0].split(':')[0] || 'usuário';
            const isSelf = targetNum === senderNum;

            // visual igual ao de mídia convertida (╭─── / │ / ╰───────────────)
            const caption = isSelf
                ? `╭─── *👤 PERFIL* ───\n` +
                  `│ 👤 *Usuário:* @${targetNum}\n` +
                  `│ 🤖 *Por:* ${botName}\n` +
                  `╰───────────────`
                : `╭─── *👤 PERFIL* ───\n` +
                  `│ 👤 *Usuário:* @${targetNum}\n` +
                  `│ 👥 *Solicitado por:* @${senderNum}\n` +
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
