const BUG_ALIASES = new Set(['bug', 'reportbug', 'bugreport']);
const SUG_ALIASES = new Set(['sugestao', 'sugestão', 'suggest', 'suggestion', 'ideia']);

module.exports = {
    name: 'relatar',
    aliases: ['bug', 'reportbug', 'bugreport', 'sugestao', 'sugestão', 'suggest', 'suggestion', 'ideia', 'reportar', 'feedback', 'relato'],
    category: 'geral',
    description: 'Reporta bug ou envia sugestão — guarda os 10 últimos de cada tipo (limite 999 caracteres)',
    async execute(sock, m, { from, sender, senderName, fullArgsText, commandName, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, addFeedback, FEEDBACK_LIMIT } = utils;

        // Decide o tipo: 1) pelo alias digitado (!bug / !sugestao), 2) pela 1ª palavra (!relatar bug ...).
        let kind = null;
        let text = (fullArgsText || '').trim();
        const invoked = String(commandName || '').toLowerCase();

        if (BUG_ALIASES.has(invoked)) kind = 'bug';
        else if (SUG_ALIASES.has(invoked)) kind = 'sugestao';
        else {
            const first = text.split(/\s+/)[0].toLowerCase();
            if (first === 'bug' || first === 'bugs') { kind = 'bug'; text = text.slice(first.length).trim(); }
            else if (['sugestao', 'sugestão', 'sug', 'sugest', 'ideia'].includes(first)) { kind = 'sugestao'; text = text.slice(first.length).trim(); }
        }

        const isBug = kind === 'bug';
        const emoji = isBug ? '🐛' : '💡';
        let current = await react(sock, m, emoji, lastBotResponse, GLOBAL_COOLDOWN);

        if (!kind || !text) {
            await sock.sendMessage(from, {
                text: `📝 *Relatar*\n\n` +
                    `Use: *${config.prefix}relatar bug <mensagem>* ou *${config.prefix}relatar sugestao <mensagem>*\n` +
                    `Atalhos: *${config.prefix}bug <msg>* e *${config.prefix}sugestao <msg>*\n\n` +
                    `📌 Limite: ${FEEDBACK_LIMIT} caracteres\n` +
                    `📌 São guardados os 10 últimos de cada tipo`
            }, { quoted: m });
            return current;
        }

        if (text.length > FEEDBACK_LIMIT) {
            await sock.sendMessage(from, {
                text: `❌ *Mensagem muito longa*\n\n` +
                    `Limite: *${FEEDBACK_LIMIT}* caracteres\n` +
                    `Enviado: *${text.length}* caracteres\n\n` +
                    `Por favor, resuma seu relato.`
            }, { quoted: m });
            current = await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
            return current;
        }

        const isGroup = from.endsWith('@g.us');
        const result = addFeedback(kind, text, sender, senderName, isGroup ? from : null);

        if (!result.ok) {
            await sock.sendMessage(from, { text: `❌ Falha ao salvar: ${result.error}` }, { quoted: m });
            current = await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
            return current;
        }

        await sock.sendMessage(from, {
            text: isBug
                ? `✅ *Bug reportado com sucesso!* 🐛\n\n> ${text.slice(0, 900)}${text.length > 900 ? '...' : ''}\n\n_Obrigado pelo feedback! Nossa equipe irá analisar._`
                : `✅ *Sugestão enviada com sucesso!* 💡\n\n> ${text.slice(0, 900)}${text.length > 900 ? '...' : ''}\n\n_Obrigado pela sugestão! Vamos analisar com carinho._`
        }, { quoted: m });

        current = await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
        return current;
    }
};
