const { synthesize } = require('../lib/tts');
const fs = require('fs');

module.exports = {
    name: 'tts',
    aliases: ['falar', 'voz'],
    category: 'utilidades',
    description: 'Converte texto em áudio usando Piper TTS (Offline)',
    async execute(sock, m, { from, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        const text = args.join(' ');
        
        if (!text) return sock.sendMessage(from, { text: '❌ Digite o texto que deseja converter em áudio.' }, { quoted: m });

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
