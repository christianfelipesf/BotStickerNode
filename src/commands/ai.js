module.exports = {
    name: 'ai',
    aliases: ['ia', 'grok', 'gemini', 'gpt', 'chatgpt'],
    category: 'ai',
    description: 'Pergunta para a inteligência artificial',
    async execute(sock, m, { from, fullArgsText, utils, model, config, lastBotResponse, GLOBAL_COOLDOWN, abortSignal }) {
        const { react, reactStatus, getMessageText } = utils;
        if (!model) {
            await sock.sendMessage(from, { text: '❌ IA não configurada. Defina OPENROUTER_API_KEY no arquivo .env' }, { quoted: m });
            return lastBotResponse;
        }
        
        try {
            let prompt = fullArgsText;
            const quotedInfo = m.message.extendedTextMessage?.contextInfo;
            const quotedMsg = quotedInfo?.quotedMessage;
            const maxPromptLength = Number(config?.aiMaxPromptLength) || 2000;

            if (quotedMsg) {
                const quotedText = getMessageText(quotedMsg);
                if (quotedText) {
                    const quotedSender = quotedInfo.pushName || 'Usuário';
                    prompt = `Contexto da mensagem de ${quotedSender}: "${quotedText}"\n\nPergunta/Comando: ${fullArgsText || 'Analise ou responda a esta mensagem.'}`;
                }
            }

            if (!prompt) {
                await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
                await sock.sendMessage(from, { text: '❌ Digite um texto para conversar com a IA.' }, { quoted: m });
                return lastBotResponse;
            }

            if (prompt.length > maxPromptLength * 2) {
                await sock.sendMessage(from, { text: `❌ Prompt muito longo (${prompt.length} caracteres). Máximo permitido: ${maxPromptLength * 2}.` }, { quoted: m });
                return lastBotResponse;
            }

            let currentBotResponse = await react(sock, m, '🤖', lastBotResponse, GLOBAL_COOLDOWN); 
            const result = await model.generateContent(prompt, { signal: abortSignal });
            const text = String(result.response.text() ?? '').trim();
            if (!text) throw new Error('Resposta vazia da IA');
            await sock.sendMessage(from, { text }, { quoted: m }); 
            return await reactStatus(sock, m, from, true, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (e) {
            // ABORTED = o dispatcher (message.js) já avisou o timeout ao usuário; evita resposta zumbi duplicada
            if (e?.code === 'ABORTED' || abortSignal?.aborted) return lastBotResponse;
            console.error('❌ [IA] Erro:', e?.response?.data || e.message || e);
            const msg = String(e?.message || '');
            if (/resposta vazia/i.test(msg)) {
                await sock.sendMessage(from, { text: '❌ A IA retornou resposta vazia. Tente novamente com outra pergunta.' }, { quoted: m });
            } else {
                await sock.sendMessage(from, { text: '❌ Comandos de IA indisponíveis no momento.' }, { quoted: m });
            }
            return lastBotResponse;
        }
    }
};
