module.exports = {
    name: 'bug',
    aliases: ['reportbug', 'bugreport'],
    category: 'geral',
    description: 'Reporta um bug — guarda os 10 últimos (limite 999 caracteres)',
    async execute(sock, m, { from, sender, senderName, fullArgsText, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, addFeedback, FEEDBACK_LIMIT } = utils;
        let current = await react(sock, m, '🐛', lastBotResponse, GLOBAL_COOLDOWN);

        const text = (fullArgsText || '').trim();

        if (!text) {
            await sock.sendMessage(from, {
                text: `🐛 *Reportar Bug*\n\n` +
                    `Use: *${config.prefix}bug <mensagem>*\n` +
                    `Ex: *${config.prefix}bug o sticker não está funcionando no grupo X*\n\n` +
                    `📌 Limite: ${FEEDBACK_LIMIT} caracteres\n` +
                    `📌 São guardados os 10 últimos reports`
            }, { quoted: m });
            return current;
        }

        if (text.length > FEEDBACK_LIMIT) {
            await sock.sendMessage(from, {
                text: `❌ *Mensagem muito longa*\n\n` +
                    `Limite: *${FEEDBACK_LIMIT}* caracteres\n` +
                    `Enviado: *${text.length}* caracteres\n\n` +
                    `Por favor, resuma seu report.`
            }, { quoted: m });
            current = await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
            return current;
        }

        const isGroup = from.endsWith('@g.us');
        const result = addFeedback('bug', text, sender, senderName, isGroup ? from : null);

        if (!result.ok) {
            await sock.sendMessage(from, { text: `❌ Falha ao salvar bug: ${result.error}` }, { quoted: m });
            current = await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
            return current;
        }

        await sock.sendMessage(from, {
            text: `✅ *Bug reportado com sucesso!* 🐛\n\n` +
                `> ${text.slice(0, 900)}${text.length > 900 ? '...' : ''}\n\n` +
                `_Obrigado pelo feedback! Nossa equipe irá analisar._`
        }, { quoted: m });

        current = await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
        return current;
    }
};
