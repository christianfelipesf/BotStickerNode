const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

module.exports = {
    name: 'play',
    aliases: ['p', 'musica', 'youtube'],
    category: 'mídia',
    description: 'Baixa áudio do YouTube',
    async execute(sock, m, { from, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        const q = fullArgsText.trim();
        
        if (!q) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        
        let currentBotResponse = await react(sock, m, '🔎', lastBotResponse, GLOBAL_COOLDOWN);
        
        try {
            const searchResults = await yts(q);
            const video = searchResults.videos[0]; 
            
            if (!video) {
                await sock.sendMessage(from, { text: '❌ Nenhum vídeo encontrado.' }, { quoted: m });
                return await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
            }

            currentBotResponse = await react(sock, m, '⬇️', currentBotResponse, GLOBAL_COOLDOWN);

            const tempName = `music_${Date.now()}.mp3`;
            const tempDir = path.join(process.cwd(), 'temp');
            const outPath = path.join(tempDir, tempName);
            
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

            console.log(`🎵 [PLAY] Baixando: ${video.title}`);
            
            // Usando yt-dlp para baixar e converter. 
            // Como yt-dlp faz o download e a conversão, usaremos o emoji de conversão logo após o download começar.
            const downloadCmd = `yt-dlp --no-warnings --extract-audio --audio-format mp3 --audio-quality 128K --output "${outPath}" "${video.url}"`;
            
            await new Promise((resolve, reject) => {
                const process = exec(downloadCmd, (error) => {
                    if (error) {
                        console.error(`❌ [YT-DLP] Erro: ${error.message}`);
                        return reject(error);
                    }
                    resolve();
                });
                
                // Simular mudança para emoji de conversão após alguns segundos (quando o download geralmente termina e a conversão começa)
                setTimeout(async () => {
                    currentBotResponse = await react(sock, m, '🔄', currentBotResponse, GLOBAL_COOLDOWN);
                }, 5000);
            });

            if (fs.existsSync(outPath)) { 
                await sock.sendMessage(from, { 
                    audio: { url: outPath }, 
                    mimetype: 'audio/mp4', 
                    fileName: `${video.title}.mp3` 
                }, { quoted: m }); 
                
                fs.unlinkSync(outPath); 
                currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN); 
            } else {
                throw new Error('Arquivo não foi gerado');
            }
        } catch (e) { 
            console.error('❌ [PLAY] Falha geral:', e);
            await sock.sendMessage(from, { text: '❌ Falha ao processar o áudio. Verifique se o yt-dlp está atualizado.' }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN); 
        }
        
        return currentBotResponse;
    }
};
