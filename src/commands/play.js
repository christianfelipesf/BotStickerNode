const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const axios = require('axios');
const { getMaxDurationSeconds, formatDuration } = require('../services/durationLimit');

const cookiesPath = path.join(process.cwd(), 'cookies.txt');

function parseDurationToSeconds(d) {
    if (typeof d === 'number' && Number.isFinite(d)) return d;
    if (typeof d === 'string') {
        const parts = d.split(':').map(Number);
        if (parts.some(isNaN)) return 0;
        if (parts.length === 3) return parts[0]*3600+parts[1]*60+parts[2];
        if (parts.length === 2) return parts[0]*60+parts[1];
        if (parts.length === 1) return parts[0];
    }
    if (d && typeof d === 'object') {
        if (typeof d.seconds === 'number') return d.seconds;
        if (typeof d.timestamp === 'string') return parseDurationToSeconds(d.timestamp);
    }
    return 0;
}

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

            const safeTitle = String(video.title || 'sem título').trim() || 'sem título';
            const duration = parseDurationToSeconds(video.seconds ?? video.duration);
            const maxSeconds = getMaxDurationSeconds();
            if (duration > maxSeconds) {
                await sock.sendMessage(from, {
                    text: `⏱️ *Limite de duração excedido!*\n\n📌 O *!play* baixa no máximo *${formatDuration(maxSeconds)}* (${maxSeconds}s).\n🎵 *Vídeo:* ${safeTitle}\n⏰ *Duração:* ${formatDuration(duration)}\n\n💡 Para vídeos longos, use *!d <link>* e baixe apenas o trecho que quiser em outro app.\n⚙️ _Limite configurável:_ \`!set maxMediaDurationSeconds <segundos>\``
                }, { quoted: m });
                return await reactStatus(sock, m, from, false, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
            }

            currentBotResponse = await react(sock, m, '⬇️', currentBotResponse, GLOBAL_COOLDOWN);

            const tempName = `music_${crypto.randomBytes(4).toString('hex')}.mp3`;
            const tempDir = path.join(process.cwd(), 'temp');
            const outPath = path.join(tempDir, tempName);

            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            console.log(`🎵 [PLAY] Baixando: ${safeTitle} (${formatDuration(duration)})`);

            const hasCookies = fs.existsSync(cookiesPath);
            // tenta yt-dlp com cookies/user-agent (igual download.js) + fallback BTCH
            let downloaded = false;
            let lastError = '';

            try {
                await new Promise((resolve, reject) => {
                    const args = [
                        '--no-warnings',
                        '--no-check-certificates',
                        '--retries', '5',
                        '--fragment-retries', '5',
                        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        '--extractor-args', 'youtube:player_client=android,web',
                        '--extract-audio',
                        '--audio-format', 'mp3',
                        '--audio-quality', '128K',
                        '--no-playlist',
                        '--output', outPath,
                        ...(hasCookies ? ['--cookies', cookiesPath] : []),
                        video.url
                    ];
                    const proc = spawn('yt-dlp', args, { windowsHide: true });

                    let stderr = '';
                    let timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} reject(new Error('yt-dlp timeout 180s')); }, 180000);
                    let reactTimer = setTimeout(async () => {
                        try { currentBotResponse = await react(sock, m, '🔄', currentBotResponse, GLOBAL_COOLDOWN); } catch (_) {}
                    }, 5000);
                    proc.stderr.on('data', (d) => { stderr += d.toString(); });
                    proc.on('error', (err) => {
                        clearTimeout(timer); clearTimeout(reactTimer);
                        console.error(`❌ [YT-DLP] Erro: ${err.message}`);
                        reject(err);
                    });
                    proc.on('close', (code) => {
                        clearTimeout(timer); clearTimeout(reactTimer);
                        if (code === 0) resolve();
                        else reject(new Error(`yt-dlp exit code ${code}: ${stderr.slice(0, 300)}`));
                    });
                });
                try { downloaded = fs.existsSync(outPath) && fs.statSync(outPath).size > 1024; } catch (_) { downloaded = false; }
            } catch (e) {
                lastError = e.message;
                console.log(`⚠️ [PLAY] yt-dlp falhou: ${lastError} — tentando fallback API...`);
            }

            // Fallback: API btch-downloader (funciona mesmo com IP bloqueado pelo YouTube)
            if (!downloaded) {
                try { if (fs.existsSync(outPath)) try { fs.unlinkSync(outPath); } catch (_) {} } catch (_) {}
                try {
                    const apiUrl = `https://backend1.tioo.eu.org/youtube?url=${encodeURIComponent(video.url)}`;
                    const res = await axios.get(apiUrl, {
                        headers: { 'User-Agent': 'btch/6.0.36' },
                        timeout: 30000,
                        maxContentLength: 2 * 1024 * 1024
                    });
                    const mp3Url = res.data?.mp3 || res.data?.result?.mp3 || res.data?.audio;
                    if (!mp3Url) throw new Error('API sem mp3');
                    if (!/^https?:\/\//i.test(mp3Url)) throw new Error('URL fallback inválida');
                    console.log(`🎵 [PLAY] fallback BTCH: ${mp3Url.slice(0, 80)}...`);
                    const writer = fs.createWriteStream(outPath);
                    const dl = await axios({ url: mp3Url, method: 'GET', responseType: 'stream', timeout: 120000, maxContentLength: 100*1024*1024, maxBodyLength: 100*1024*1024 });
                    let total = 0;
                    dl.data.on('data', c => { total += c.length; if (total > 100*1024*1024) { try { dl.data.destroy(); writer.destroy(); } catch (_) {} } });
                    dl.data.pipe(writer);
                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                        dl.data.on('error', reject);
                    });
                    try { downloaded = fs.existsSync(outPath) && fs.statSync(outPath).size > 1024; } catch (_) { downloaded = false; }
                    if (!downloaded) throw new Error('fallback não gerou arquivo');
                } catch (fbErr) {
                    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
                    throw new Error(lastError ? `${lastError} | fallback: ${fbErr.message}` : fbErr.message);
                }
            }

            if (fs.existsSync(outPath)) {
                try { if (fs.statSync(outPath).size < 1024) throw new Error('Arquivo muito pequeno'); } catch (e) { throw new Error('Arquivo não foi gerado: ' + e.message); }
                await sock.sendMessage(from, {
                    audio: { url: outPath },
                    mimetype: 'audio/mp4',
                    fileName: `${String(video.title || 'audio').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.mp3`
                }, { quoted: m });

                try { fs.unlinkSync(outPath); } catch (_) {}
                currentBotResponse = await reactStatus(sock, m, from, true, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
            } else {
                throw new Error('Arquivo não foi gerado');
            }
        } catch (e) {
            try { if (typeof outPath !== 'undefined' && outPath && fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
            console.error('❌ [PLAY] Falha geral:', e);
            const is403 = e.message.includes('403') || e.message.includes('Forbidden');
            const hint = is403
                ? '\n\n💡 *YouTube bloqueou seu IP (403 Forbidden).* Soluções:\n1. Crie `cookies.txt` na raiz (extensão \"Get cookies.txt\" logado no YouTube)\n2. Ou use `!dl <link>` que já tem fallback automático'
                : '';
            await sock.sendMessage(from, { text: `❌ Falha ao baixar áudio.${hint}\n\n\`${e.message.slice(0, 200)}\`` }, { quoted: m });
            currentBotResponse = await reactStatus(sock, m, from, false, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
