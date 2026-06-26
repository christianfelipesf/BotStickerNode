const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const axios = require('axios');
const { getMaxDurationSeconds, fetchYouTubeDuration, buildDurationErrorMessage } = require('../services/durationLimit');

const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const cookiesPath = path.join(process.cwd(), 'cookies.txt');
const hasCookies = fs.existsSync(cookiesPath);

const URL_REGEX = /https?:\/\/[^\s<>"']+/i;

const BTCH_BASE_URL = 'https://backend1.tioo.eu.org';

const PLATFORM_CONFIG = {
    instagram: { api: 'igdl', hosts: ['instagram.com'], domains: ['instagram.com'], ytdlp: true },
    tiktok: { api: 'ttdl', hosts: ['tiktok.com', 'vm.tiktok.com'], domains: ['tiktok.com'], ytdlp: true },
    facebook: { api: 'fbdown', hosts: ['facebook.com', 'fb.watch'], domains: ['facebook.com', 'fb.watch'], ytdlp: true },
    twitter: { api: 'twitter', hosts: ['twitter.com', 'x.com', 't.co'], domains: ['twitter.com', 'x.com', 't.co'], ytdlp: true },
    youtube: { api: 'youtube', hosts: ['youtube.com', 'youtu.be'], domains: ['youtube.com', 'youtu.be'], ytdlp: true },
    capcut: { api: 'capcut', hosts: ['capcut.com', 'capcut.net'], domains: ['capcut.com'], ytdlp: false },
    pinterest: { api: 'pinterest', hosts: ['pinterest.com', 'pin.it'], domains: ['pinterest.com', 'pin.it'], ytdlp: false },
    gdrive: { api: 'gdrive', hosts: ['drive.google.com'], domains: ['drive.google.com'], ytdlp: false },
    mediafire: { api: 'mediafire', hosts: ['mediafire.com'], domains: ['mediafire.com'], ytdlp: false },
    douyin: { api: 'douyin', hosts: ['douyin.com', 'v.douyin.com'], domains: ['douyin.com'], ytdlp: false },
    snackvideo: { api: 'snackvideo', hosts: ['snackvideo.com', 's.snackvideo.com'], domains: ['snackvideo.com'], ytdlp: false },
    xiaohongshu: { api: 'rednote', hosts: ['xiaohongshu.com', 'xhslink.com'], domains: ['xiaohongshu.com', 'xhslink.com'], ytdlp: false },
    cocofun: { api: 'cocofun', hosts: ['icocofun.com', 'cocofun.com'], domains: ['icocofun.com', 'cocofun.com'], ytdlp: false },
    spotify: { api: 'spotify', hosts: ['open.spotify.com', 'spotify.link'], domains: ['spotify.com'], ytdlp: false },
    soundcloud: { api: 'soundcloud', hosts: ['soundcloud.com'], domains: ['soundcloud.com'], ytdlp: false },
    threads: { api: 'threads', hosts: ['threads.net'], domains: ['threads.net'], ytdlp: false },
    kuaishou: { api: 'kuaishou', hosts: ['kuaishou.com', 'v.kuaishou.com'], domains: ['kuaishou.com'], ytdlp: false },
    reddit: { api: null, hosts: ['reddit.com', 'redd.it'], domains: ['reddit.com'], ytdlp: true },
    google: { api: null, hosts: ['google.com'], domains: ['google.com'], ytdlp: true }
};

function extractUrl(text) {
    if (!text) return null;
    const match = text.match(URL_REGEX);
    return match ? match[0].replace(/[).,;]+$/, '') : null;
}

function getPlatform(url) {
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        for (const [name, cfg] of Object.entries(PLATFORM_CONFIG)) {
            if (cfg.hosts.some(h => host === h || host.endsWith('.' + h))) return name;
        }
        return null;
    } catch (e) {
        return null;
    }
}

const YTDLP_PLATFORMS = new Set(Object.entries(PLATFORM_CONFIG).filter(([, c]) => c.ytdlp).map(([k]) => k));
const BTCH_PLATFORMS = new Set(Object.entries(PLATFORM_CONFIG).filter(([, c]) => c.api).map(([k]) => k));

function getFormatSelector(platform, hd) {
    if (platform === 'instagram') {
        return hd ? 'best[height<=1080]/best' : 'best[height<=720]/best';
    }
    if (platform === 'tiktok') {
        return hd
            ? 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best'
            : 'worstvideo[ext=mp4]+bestaudio[ext=m4a]/worst[ext=mp4]/worst';
    }
    if (platform === 'facebook') {
        return hd ? 'bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best' : 'worst[ext=mp4]/worst';
    }
    if (platform === 'twitter') {
        return hd
            ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
            : 'worstvideo[ext=mp4]+bestaudio[ext=m4a]/worst[ext=mp4]/worst/best[width<=640]';
    }
    return hd
        ? 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
        : 'worstvideo[ext=mp4]+bestaudio[ext=m4a]/worst[ext=mp4]+bestaudio[ext=m4a]/worst[ext=mp4]/worst';
}

function buildYtDlpArgs(url, platform, hd, outTemplate) {
    const args = [
        '--no-warnings',
        '--no-check-certificates',
        '--ignore-errors',
        '--no-abort-on-error',
        '--retries', '5',
        '--fragment-retries', '5',
        '--concurrent-fragments', '4',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        '--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com',
        '-f', getFormatSelector(platform, hd),
        '--merge-output-format', 'mp4',
        '-o', outTemplate
    ];

    if (platform === 'instagram') {
        args.push('--add-header', 'Referer:https://www.instagram.com/');
    } else if (platform === 'twitter') {
        args.push('--yes-playlist');
        args.push('--add-header', 'Referer:https://x.com/');
        args.push('--add-header', 'Origin:https://x.com');
    } else {
        args.push('--no-playlist');
    }

    if (hasCookies) args.push('--cookies', cookiesPath);

    args.push(url);
    return args;
}

function runYtDlp(args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', args, { shell: false, windowsHide: true });
        let stdout = '', stderr = '';
        const timer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (_) {}
            reject(new Error(`yt-dlp timeout após ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);

        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('error', err => { clearTimeout(timer); reject(err); });
        proc.on('close', code => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        });
    });
}

async function callBtchApi(endpoint, url) {
    const apiUrl = `${BTCH_BASE_URL}/${endpoint}?url=` + encodeURIComponent(url);
    const res = await axios.get(apiUrl, {
        headers: { 'User-Agent': 'btch/6.0.36', 'X-Client-Version': '6.0.36' },
        timeout: 30000
    });
    if (res.status !== 200) throw new Error(`API HTTP ${res.status}`);
    return res.data;
}

async function downloadFromUrl(fileUrl, destPath) {
    const writer = fs.createWriteStream(destPath);
    const res = await axios({ url: fileUrl, method: 'GET', responseType: 'stream', timeout: 120000 });
    res.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

async function downloadBtch(platform, url, id, hd) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg || !cfg.api) return [];
    console.log(`[BTCH] ${platform} downloading via btch-downloader...`);
    try {
        const data = await callBtchApi(cfg.api, url);
        const results = [];
        const dl = (mediaUrl, idx = 0) => {
            if (!mediaUrl) return null;
            const ext = path.extname(new URL(mediaUrl).pathname) || '.mp4';
            const dest = path.join(tempDir, `dl_${id}_btch_${idx}${ext}`);
            return { url: mediaUrl, dest };
        };

        if (platform === 'instagram') {
            if (!Array.isArray(data)) throw new Error('resposta inválida');
            for (let i = 0; i < data.length; i++) {
                const item = dl(data[i].url, i);
                if (!item) continue;
                await downloadFromUrl(item.url, item.dest);
                results.push(item.dest);
            }
        } else if (platform === 'tiktok') {
            const videos = hd ? (data?.video || []) : (data?.video?.length ? [data.video[data.video.length - 1]] : []);
            if (!videos.length && data?.video?.length) throw new Error('sem mídia');
            const arr = data?.video || [];
            for (let i = 0; i < arr.length; i++) {
                const item = dl(arr[i], i);
                if (!item) continue;
                await downloadFromUrl(item.url, item.dest);
                results.push(item.dest);
            }
        } else if (platform === 'facebook') {
            const fbUrl = hd ? (data?.HD || data?.Normal_video) : (data?.Normal_video || data?.HD);
            if (!fbUrl) throw new Error('sem mídia');
            const item = dl(fbUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'twitter') {
            if (!data?.url) throw new Error('sem mídia');
            const item = dl(data.url, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'youtube') {
            const vidUrl = hd ? (data?.mp4 || data?.mp3) : (data?.mp3 || data?.mp4);
            if (!vidUrl) throw new Error('sem mídia');
            const item = dl(vidUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'capcut') {
            if (!data?.originalVideoUrl) throw new Error('sem mídia');
            const item = dl(data.originalVideoUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'pinterest') {
            if (data?.video_url) {
                const item = dl(data.video_url, 0);
                await downloadFromUrl(item.url, item.dest);
                results.push(item.dest);
            } else if (data?.image) {
                const item = dl(data.image, 0);
                await downloadFromUrl(item.url, item.dest);
                results.push(item.dest);
            } else if (data?.result?.length) {
                for (let i = 0; i < Math.min(data.result.length, 5); i++) {
                    const pin = data.result[i];
                    const imgUrl = pin?.video_url || pin?.image_url || pin?.images?.original;
                    if (!imgUrl) continue;
                    const item = dl(imgUrl, i);
                    await downloadFromUrl(item.url, item.dest);
                    results.push(item.dest);
                }
            } else throw new Error('sem mídia');
        } else if (platform === 'gdrive') {
            const dlUrl = data?.result?.downloadUrl || data?.downloadUrl;
            if (!dlUrl) throw new Error('sem mídia');
            const item = dl(dlUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'mediafire') {
            const mfUrl = data?.result?.url || data?.url;
            if (!mfUrl) throw new Error('sem mídia');
            const item = dl(mfUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'douyin') {
            const links = data?.result?.links || data?.links;
            if (!links?.length) throw new Error('sem mídia');
            const item = dl(links[0].url, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'snackvideo') {
            const svUrl = data?.result?.videoUrl || data?.videoUrl || data?.url;
            if (!svUrl) throw new Error('sem mídia');
            const item = dl(svUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'xiaohongshu') {
            const downloads = data?.result?.downloads;
            const images = data?.result?.images;
            if (downloads?.length) {
                for (let i = 0; i < downloads.length; i++) {
                    const item = dl(downloads[i].url, i);
                    if (!item) continue;
                    await downloadFromUrl(item.url, item.dest);
                    results.push(item.dest);
                }
            } else if (images?.length) {
                for (let i = 0; i < images.length; i++) {
                    const item = dl(images[i], i);
                    await downloadFromUrl(item.url, item.dest);
                    results.push(item.dest);
                }
            } else throw new Error('sem mídia');
        } else if (platform === 'cocofun') {
            const cfUrl = data?.result?.no_watermark || data?.result?.watermark || data?.no_watermark || data?.watermark;
            if (!cfUrl) throw new Error('sem mídia');
            const item = dl(cfUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'spotify') {
            const formats = data?.result?.formats || data?.formats;
            if (!formats?.length) throw new Error('sem mídia');
            const best = formats.reduce((a, b) => (parseInt(b.quality) || 0) > (parseInt(a.quality) || 0) ? b : a);
            const item = dl(best.url, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'soundcloud') {
            const scUrl = data?.result?.downloadMp3 || data?.result?.audio || data?.downloadMp3 || data?.audio;
            if (!scUrl) throw new Error('sem mídia');
            const item = dl(scUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'threads') {
            const thUrl = data?.result?.video || data?.result?.image || data?.video || data?.image;
            if (!thUrl) throw new Error('sem mídia');
            const item = dl(thUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        } else if (platform === 'kuaishou') {
            const ksUrl = data?.result?.videoUrl || data?.videoUrl;
            if (!ksUrl) throw new Error('sem mídia');
            const item = dl(ksUrl, 0);
            await downloadFromUrl(item.url, item.dest);
            results.push(item.dest);
        }

        if (!results.length) throw new Error('nenhuma mídia baixada');
        return results;
    } catch (e) {
        console.log(`[BTCH] ${platform} falhou: ${e.message}`);
        return [];
    }
}

function findDownloadedFiles(id) {
    try {
        const files = fs.readdirSync(tempDir)
            .filter(f => f.startsWith(`dl_${id}_`) && /\.(mp4|webm|mkv|m4a|mp3|jpg|jpeg|png|gif|webp)$/i.test(f) && !f.endsWith('.part'))
            .map(f => ({
                path: path.join(tempDir, f),
                time: fs.statSync(path.join(tempDir, f)).mtimeMs,
                size: fs.statSync(path.join(tempDir, f)).size,
                name: f
            }))
            .filter(f => f.size >= 1024)
            .sort((a, b) => a.time - b.time);

        return files.map(f => f.path);
    } catch (_) {
        return [];
    }
}

async function sendMedia(sock, from, m, filePath, title) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = (() => {
        if (['.mp4', '.webm', '.mkv', '.mov'].includes(ext)) return 'video/mp4';
        if (['.jpg', '.jpeg'].includes(ext)) return 'image/jpeg';
        if (['.png'].includes(ext)) return 'image/png';
        if (['.gif'].includes(ext)) return 'image/gif';
        if (['.webp'].includes(ext)) return 'image/webp';
        if (['.mp3', '.m4a', '.ogg'].includes(ext)) return 'audio/mpeg';
        return 'application/octet-stream';
    })();

    const fileName = (title ? title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) : 'media') + ext;

    if (mime.startsWith('video/')) {
        await sock.sendMessage(from, { video: { url: filePath }, mimetype: 'video/mp4', fileName }, { quoted: m });
    } else if (mime.startsWith('image/')) {
        await sock.sendMessage(from, { image: { url: filePath }, fileName }, { quoted: m });
    } else if (mime.startsWith('audio/')) {
        await sock.sendMessage(from, { audio: { url: filePath }, mimetype: 'audio/mp4', fileName }, { quoted: m });
    } else {
        await sock.sendMessage(from, { document: { url: filePath }, fileName, mimetype: mime }, { quoted: m });
    }
}

module.exports = {
    name: 'download',
    aliases: ['d', 'dl', 'baixar', 'media', 'social', 'tiktok', 'ttk', 'fb', 'facebook', 'insta', 'instagram', 'reel', 'shorts', 'youtube', 'yt', 'twitter', 'x'],
    category: 'mídia',
    description: 'Baixa mídia de redes sociais (Instagram, TikTok, YouTube, Facebook, Twitter, CapCut, Pinterest, Google Drive, e mais)',
    async execute(sock, m, { from, fullArgsText, commandName, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus } = utils;
        const hd = commandName === 'downloadhd' || commandName === 'dhd';
        const url = extractUrl(fullArgsText);

        if (!url) {
            await react(sock, m, '❓', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, {
                text: `❌ *Envie um link válido!*\n\n📌 *Uso:* ${hd ? '!dhd' : '!d'} <link>\n\n✅ *Plataformas suportadas:*\n• Instagram (posts/reels/carrosséis)\n• TikTok (videos)\n• YouTube (videos/música)\n• Facebook (videos/reels)\n• Twitter / X (imagens/videos)\n• CapCut (templates)\n• Pinterest (pins/imagens/videos)\n• Google Drive (arquivos)\n• MediaFire (arquivos)\n• Douyin (videos)\n• Xiaohongshu (posts)\n• Spotify (música)\n• SoundCloud (música)\n• Threads (imagens/videos)\n• Kuaishou (videos)\n• SnackVideo, Cocofun\n• Reddit, Google Imagens`
            }, { quoted: m });
        }

        const platform = getPlatform(url);
        if (!platform) {
            await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, {
                text: `❌ *Site não suportado!*\n\n🔗 ${url}`
            }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '🔎', lastBotResponse, GLOBAL_COOLDOWN);

        if (platform === 'youtube') {
            const maxSeconds = getMaxDurationSeconds();
            const info = await fetchYouTubeDuration(url, hasCookies ? cookiesPath : null);
            if (Number.isFinite(info.seconds) && info.seconds > maxSeconds) {
                await sock.sendMessage(from, {
                    text: buildDurationErrorMessage({ url, seconds: info.seconds, title: info.title, platform, maxSeconds })
                }, { quoted: m });
                return await react(sock, m, '⏱️', currentBotResponse, GLOBAL_COOLDOWN);
            }
        }

        const id = crypto.randomBytes(4).toString('hex');

        try {
            currentBotResponse = await react(sock, m, '⬇️', currentBotResponse, GLOBAL_COOLDOWN);

            let allFiles = [];

            if (BTCH_PLATFORMS.has(platform)) {
                currentBotResponse = await react(sock, m, '📥', currentBotResponse, GLOBAL_COOLDOWN);
                allFiles = await downloadBtch(platform, url, id, hd);
            }

            if (allFiles.length === 0 && YTDLP_PLATFORMS.has(platform)) {
                console.log(`[YT-DLP] ${platform} fallback via yt-dlp...`);
                const template = path.join(tempDir, `dl_${id}_%(playlist_index|)s%(playlist_index&_|)s%(id)s.%(ext)s`);

                let title = '';
                try {
                    const titleArgs = [
                        '--no-warnings', '--ignore-errors', '--no-abort-on-error',
                        '--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com',
                        '--print', '%(title)s',
                        ...(hasCookies ? ['--cookies', cookiesPath] : []),
                    ];
                    if (platform === 'twitter') titleArgs.push('--yes-playlist');
                    else titleArgs.push('--no-playlist');
                    const dump = spawn('yt-dlp', [...titleArgs, url], { shell: false, windowsHide: true });
                    const chunks = [];
                    dump.stdout.on('data', d => chunks.push(d));
                    await new Promise((resolve) => { dump.on('error', () => resolve()); dump.on('close', () => resolve()); });
                    title = Buffer.concat(chunks).toString('utf8').trim().split('\n')[0];
                } catch (_) { title = '' }

                let result = await runYtDlp(buildYtDlpArgs(url, platform, hd, template));
                allFiles = findDownloadedFiles(id);

                if (allFiles.length === 0 && platform === 'instagram' && !hasCookies) {
                    for (const browser of ['chrome', 'brave', 'firefox', 'edge']) {
                        console.log(`[RETRY] Instagram --cookies-from-browser ${browser}...`);
                        const retryArgs = buildYtDlpArgs(url, platform, hd, template);
                        retryArgs.splice(retryArgs.indexOf('--add-header'), 0, '--cookies-from-browser', browser);
                        result = await runYtDlp(retryArgs, 60000);
                        allFiles = findDownloadedFiles(id);
                        if (allFiles.length > 0) break;
                    }
                }

                if (allFiles.length === 0 && platform === 'instagram') {
                    console.log(`[RETRY] Instagram --yes-playlist...`);
                    const retryArgs = buildYtDlpArgs(url, platform, hd, template);
                    retryArgs.splice(retryArgs.indexOf('--add-header'), 0, '--yes-playlist', '--extractor-args', 'instagram:allow_direct_url=True');
                    result = await runYtDlp(retryArgs);
                    allFiles = findDownloadedFiles(id);
                }
            }

            if (allFiles.length === 0 && platform === 'instagram') {
                const result = { stderr: '' };
                throw new Error(`Instagram bloqueou o acesso. Use cookies.txt na raiz do bot (extensão Get cookies.txt) ou tente no terminal: yt-dlp --cookies-from-browser chrome "${url}"`);
            }

            if (allFiles.length === 0) {
                throw new Error('Não foi possível baixar a mídia. O link pode ser inválido ou estar protegido.');
            }

            const totalSize = allFiles.reduce((acc, f) => acc + fs.statSync(f).size, 0);
            if (totalSize > 100 * 1024 * 1024) {
                for (const f of allFiles) { try { fs.unlinkSync(f); } catch (_) {} }
                throw new Error(`Limite de 100MB excedido (${(totalSize / 1048576).toFixed(2)}MB).`);
            }

            currentBotResponse = await react(sock, m, '📤', currentBotResponse, GLOBAL_COOLDOWN);

            for (let i = 0; i < allFiles.length; i++) {
                const filePath = allFiles[i];
                const ext = path.extname(filePath).slice(1).toUpperCase();
                const caption = allFiles.length > 1 ? `📎 *Mídia* (${i + 1}/${allFiles.length}) [${ext}]` : 'Mídia';
                await sendMedia(sock, from, m, filePath, caption);
                try { fs.unlinkSync(filePath); } catch (_) {}
                if (allFiles.length > 1) await new Promise(r => setTimeout(r, 800));
            }

            return await reactStatus(sock, m, from, true, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);

        } catch (e) {
            console.error(`\x1b[31m[DOWNLOAD ERROR]\x1b[0m ${e.message}`);
            if (e.stack) console.error(`\x1b[2m${e.stack.split('\n').slice(1, 3).join('\n')}\x1b[0m`);

            const partial = findDownloadedFiles(id);
            for (const f of partial) { try { fs.unlinkSync(f); } catch (_) {} }

            currentBotResponse = await reactStatus(sock, m, from, false, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, {
                text: `❌ *Falha no Download!*\n\n💬 *Motivo:* ${e.message}\n\n💡 Tente novamente ou use um link diferente.`
            }, { quoted: m });
            return currentBotResponse;
        }
    }
};
