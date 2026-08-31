module.exports = {
    name: 'sugestao',
    aliases: ['sugestão', 'suggest', 'suggestion', 'ideia'],
    category: 'geral',
    description: 'Envia uma sugestão — guarda as 10 últimas (limite 999 caracteres)',
    async execute(sock, m, { from, sender, senderName, fullArgsText, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, addFeedback, FEEDBACK_LIMIT } = utils;
        let current = await react(sock, m, '💡', lastBotResponse, GLOBAL_COOLDOWN);

        const text = (fullArgsText || '').trim();

        if (!text) {
            await sock.sendMessage(from, {
                text: `💡 *Enviar Sugestão*\n\n` +
                    `Use: *${config.prefix}sugestao <mensagem>*\n` +
                    `Ex: *${config.prefix}sugestao adicionar comando de enquete*\n\n` +
                    `📌 Limite: ${FEEDBACK_LIMIT} caracteres\n` +
                    `📌 São guardadas as 10 últimas sugestões`
            }, { quoted: m });
            return current;
        }

        if (text.length > FEEDBACK_LIMIT) {
            await sock.sendMessage(from, {
                text: `❌ *Mensagem muito longa*\n\n` +
                    `Limite: *${FEEDBACK_LIMIT}* caracteres\n` +
                    `Enviado: *${text.length}* caracteres\n\n` +
                    `Por favor, resuma sua sugestão.`
            }, { quoted: m });
            current = await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
            return current;
        }

        const isGroup = from.endsWith('@g.us');
        const result = addFeedback('sugestao', text, sender, senderName, isGroup ? from : null);

        if (!result.ok) {
            await sock.sendMessage(from, { text: `❌ Falha ao salvar sugestão: ${result.error}` }, { quoted: m });
            current = await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
            return current;
        }

        await sock.sendMessage(from, {
            text: `✅ *Sugestão enviada com sucesso!* 💡\n\n` +
                `> ${text.slice(0, 900)}${text.length > 900 ? '...' : ''}\n\n` +
                `_Obrigado pela sugestão! Vamos analisar com carinho._`
        }, { quoted: m });

        current = await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
        return current;
    }
};
