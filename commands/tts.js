const { synthesize } = require('../lib/tts');
const fs = require('fs');

module.exports = {
    name: 'tts',
    aliases: ['falar', 'voz', 'fala', 'speak'],
    category: 'utilidades',
    description: 'Converte texto em áudio usando Piper TTS (Offline)',
    async execute(sock, m, { from, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getMessageText } = utils;
        
        // 1. Tentar pegar o texto dos argumentos diretos
        let text = args.join(' ');

        // 2. Se não houver texto direto, tentar pegar de uma mensagem marcada (quoted)
        if (!text && m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            text = getMessageText(m.message.extendedTextMessage.contextInfo.quotedMessage);
        }

        // 3. Se ainda não houver texto, tentar pegar da legenda da própria mensagem (se houver mídia)
        if (!text) {
            text = getMessageText(m.message);
        }
        
        if (!text || text.trim().length === 0) {
            return sock.sendMessage(from, { text: '❌ Digite o texto ou marque uma mensagem/mídia com legenda para converter em áudio.' }, { quoted: m });
        }

        // Verificar se os arquivos existem antes de tentar
        const path = require('path');
        const piperExe = path.join(process.cwd(), 'bin', 'piper', 'piper.exe');
        if (!fs.existsSync(piperExe)) {
            return sock.sendMessage(from, { text: '❌ O sistema TTS ainda não foi configurado. Por favor, execute o script de setup no servidor.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '🗣️', lastBotResponse, GLOBAL_COOLDOWN);

        try {
            const audioPath = await synthesize(text);
            const audioBuffer = fs.readFileSync(audioPath);

            await sock.sendMessage(from, { 
                audio: audioBuffer, 
                mimetype: 'audio/ogg; codecs=opus', 
                ptt: true 
            }, { quoted: m });

            // Deletar arquivo temporário
            fs.unlinkSync(audioPath);
        } catch (error) {
            console.error('Erro no TTS:', error);
            await sock.sendMessage(from, { text: `❌ Erro ao gerar áudio: ${error.message}` }, { quoted: m });
        }

        return currentBotResponse;
    }
};
