module.exports = {
    name: 'ai',
    aliases: ['ia', 'grok', 'gemini', 'gpt', 'chatgpt'],
    category: 'ai',
    description: 'Pergunta para a inteligência artificial',
    async execute(sock, m, { from, fullArgsText, utils, model, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getMessageText } = utils;
        if (!model) {
            await sock.sendMessage(from, { text: '❌ IA não configurada. Defina a geminiApiKey.' }, { quoted: m });
            return lastBotResponse;
        }
        
        try {
            let prompt = fullArgsText;
            const quotedInfo = m.message.extendedTextMessage?.contextInfo;
            const quotedMsg = quotedInfo?.quotedMessage;

            if (quotedMsg) {
                const quotedText = getMessageText(quotedMsg);
                if (quotedText) {
                    const quotedSender = quotedInfo.pushName || 'Usuário';
                    prompt = `Contexto da mensagem de ${quotedSender}: "${quotedText}"\n\nPergunta/Comando: ${fullArgsText || 'Analise ou responda a esta mensagem.'}`;
                }
            }

            if (!prompt) return await react(sock, m, '❓', lastBotResponse, GLOBAL_COOLDOWN);

            let currentBotResponse = await react(sock, m, '🤖', lastBotResponse, GLOBAL_COOLDOWN); 
            const result = await model.generateContent(prompt);
            await sock.sendMessage(from, { text: result.response.text() }, { quoted: m }); 
            return await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (e) { 
            console.error('❌ [IA] Erro:', e);
            await sock.sendMessage(from, { text: '❌ Comandos de IA indisponíveis no momento.' }, { quoted: m });
            return lastBotResponse;
        }
    }
};
