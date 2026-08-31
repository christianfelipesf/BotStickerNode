const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const axios = require('axios');
const { getMaxDurationSeconds, formatDuration } = require('../services/durationLimit');
const { enqueueDownload, enqueueSend } = require('../services/queue');
const { sendMessageSafe } = require('../database/utils');

const cookiesPath = path.join(process.cwd(), 'cookies.txt');

const { normalizeLang, parseLangFromQuery } = require('../services/downloaderCore');

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

function searchViaYtDlp(query) {
    return new Promise((resolve) => {
        const proc = spawn('yt-dlp', [
            '--no-warnings',
            '--flat-playlist',
            '--print', '%(id)s|%(title)s|%(duration)s',
            `ytsearch1:${query}`
        ], { windowsHide: true });
        let out = '';
        const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} resolve(null); }, 30000);
        proc.stdout.on('data', d => { out += d.toString(); });
        proc.stderr.on('data', () => {});
        proc.on('error', () => { clearTimeout(timer); resolve(null); });
        proc.on('close', () => {
            clearTimeout(timer);
            const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
            if (!line) return resolve(null);
            const f = line.split('|');
            const id = f[0];
            if (!id || id === 'NA') return resolve(null);
            const title = f.length > 2 ? f.slice(1, -1).join('|') || 'sem título' : 'sem título';
            resolve({ id, url: `https://www.youtube.com/watch?v=${id}`, title, seconds: Number(f[f.length - 1]) || 0 });
        });
    });
}

async function getPlayThumbBuffer(video) {
    let thumbUrl = null;
    try {
        if (video.thumbnail) thumbUrl = typeof video.thumbnail === 'string' ? video.thumbnail : video.thumbnail.url;
        else if (video.image) thumbUrl = typeof video.image === 'string' ? video.image : video.image.url;
        else if (video.thumbnails && Array.isArray(video.thumbnails) && video.thumbnails[0]?.url) thumbUrl = video.thumbnails[0].url;
        else if (video.videoId) thumbUrl = `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`;
        else if (video.id) thumbUrl = `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`;
        else if (video.url) {
            const m = video.url.match(/(?:v=|\/)([A-Za-z0-9_-]{11})/);
            if (m) thumbUrl = `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
        }
    } catch (_) {}
    if (!thumbUrl) return null;
    try {
        const resp = await axios.get(thumbUrl, { responseType: 'arraybuffer', timeout: 8000 });
        if (!resp.data) return null;
        const { Jimp } = require('jimp');
        const img = await Jimp.read(Buffer.from(resp.data));
        try { img.resize({ w: 300, h: 300 }); } catch (_) { try { img.resize(300, 300); } catch (_) {} }
        const buf = await img.getBuffer('image/jpeg', { quality: 80 });
        if (buf.length > 100 * 1024) {
            try {
                const small = await Jimp.read(buf);
                try { small.resize({ w: 200, h: 200 }); } catch (_) { try { small.resize(200, 200); } catch (_) {} }
                return await small.getBuffer('image/jpeg', { quality: 70 });
            } catch (_) { return buf; }
        }
        return buf;
    } catch (_) { return null; }
}

module.exports = {
    name: 'play',
    aliases: ['p', 'musica', 'youtube'],
    category: 'mídia',
    description: 'Baixa áudio do YouTube (limite configurável, padrão 15 min)',
    async execute(sock, m, { from, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus } = utils;
        let q = fullArgsText.trim();

        if (!q) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        // parse lang trailing token: !play <query> [pt|original|en...] default pt
        const parsedQuery = parseLangFromQuery(q);
        const effectiveLang = parsedQuery.lang; // null = original, 'pt' = português
        q = parsedQuery.query;
        if (!q) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        let currentBotResponse = await react(sock, m, '🔎', lastBotResponse, GLOBAL_COOLDOWN);

        try {
            let video;
            try {
                video = (await yts(q)).videos[0];
            } catch (searchErr) {
                console.log(`⚠️ [PLAY] yt-search falhou (${String(searchErr.message).slice(0, 120)}) — resolvendo busca via yt-dlp`);
                video = await searchViaYtDlp(q);
            }

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
                await enqueueDownload(() => new Promise((resolve, reject) => {
                    const ytLang = effectiveLang || null;
                    const extractorArgs = ytLang ? `youtube:player_client=android,web;lang=${ytLang}` : 'youtube:player_client=android,web';
                    const formatSel = effectiveLang ? `bestaudio[language^=${effectiveLang}]/bestaudio/best` : 'bestaudio/best';
                    const args = [
                        '--no-warnings',
                        '--no-check-certificates',
                        '--retries', '5',
                        '--fragment-retries', '5',
                        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                        '--extractor-args', extractorArgs,
                        '--extract-audio',
                        '--audio-format', 'mp3',
                        '--audio-quality', '128K',
                        '-f', formatSel,
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
                }));
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
                // preview com thumb via externalAdReply (audio + foto)
                let thumb = null;
                try { thumb = await getPlayThumbBuffer(video); } catch (_) { thumb = null; }
                const audioPayload = {
                    audio: { url: outPath },
                    mimetype: 'audio/mp4',
                    fileName: `${String(video.title || 'audio').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.mp3`,
                    ...(thumb ? {
                        contextInfo: {
                            externalAdReply: {
                                title: String(safeTitle).slice(0, 40),
                                body: `${formatDuration(duration)} • YouTube`,
                                thumbnail: thumb,
                                mediaType: 1,
                                mediaUrl: video.url,
                                sourceUrl: video.url,
                                renderLargerThumbnail: true,
                                showAdAttribution: false
                            }
                        }
                    } : {})
                };
                await enqueueSend(() => sendMessageSafe(sock, from, audioPayload, { sendOptions: { quoted: m }, maxRetries: 2, baseDelayMs: 5000 }));

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
