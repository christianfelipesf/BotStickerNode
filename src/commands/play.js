const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getMaxDurationSeconds, formatDuration } = require('../services/durationLimit');

module.exports = {
    name: 'play',
    aliases: ['p', 'musica', 'youtube'],
    category: 'mídia',
    description: 'Baixa áudio do YouTube (limite configurável, padrão 15 min)',
    async execute(sock, m, { from, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus } = utils;
        const q = fullArgsText.trim();

        if (!q) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        let currentBotResponse = await react(sock, m, '🔎', lastBotResponse, GLOBAL_COOLDOWN);

        try {
            const searchResults = await yts(q);
            const video = searchResults.videos[0];

            if (!video) {
                await sock.sendMessage(from, { text: '❌ Nenhum vídeo encontrado.' }, { quoted: m });
                return await reactStatus(sock, m, from, false, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
            }

            const duration = video.duration || video.seconds || 0;
            const maxSeconds = getMaxDurationSeconds();
            if (duration > maxSeconds) {
                await sock.sendMessage(from, {
                    text: `⏱️ *Limite de duração excedido!*\n\n📌 O *!play* baixa no máximo *${formatDuration(maxSeconds)}* (${maxSeconds}s).\n🎵 *Vídeo:* ${video.title || '?'}\n⏰ *Duração:* ${formatDuration(duration)}\n\n💡 Para vídeos longos, use *!d <link>* e baixe apenas o trecho que quiser em outro app.\n⚙️ _Limite configurável:_ \`!set maxMediaDurationSeconds <segundos>\``
                }, { quoted: m });
                return await reactStatus(sock, m, from, false, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
            }

            currentBotResponse = await react(sock, m, '⬇️', currentBotResponse, GLOBAL_COOLDOWN);

            const tempName = `music_${Date.now()}.mp3`;
            const tempDir = path.join(process.cwd(), 'temp');
            const outPath = path.join(tempDir, tempName);

            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            console.log(`🎵 [PLAY] Baixando: ${video.title} (${formatDuration(duration)})`);

            await new Promise((resolve, reject) => {
                const proc = spawn('yt-dlp', [
                    '--no-warnings',
                    '--extract-audio',
                    '--audio-format', 'mp3',
                    '--audio-quality', '128K',
                    '--output', outPath,
                    video.url
                ], { windowsHide: true });

                let stderr = '';
                proc.stderr.on('data', (d) => { stderr += d.toString(); });
                proc.on('error', (err) => {
                    console.error(`❌ [YT-DLP] Erro: ${err.message}`);
                    reject(err);
                });
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`yt-dlp exit code ${code}: ${stderr.slice(0, 300)}`));
                });

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
                currentBotResponse = await reactStatus(sock, m, from, true, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
            } else {
                throw new Error('Arquivo não foi gerado');
            }
        } catch (e) {
            console.error('❌ [PLAY] Falha geral:', e);
            await sock.sendMessage(from, { text: '❌ Falha ao processar o áudio. Verifique se o yt-dlp está atualizado.' }, { quoted: m });
            currentBotResponse = await reactStatus(sock, m, from, false, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
