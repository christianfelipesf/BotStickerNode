const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const CACHE_DIR = path.join(process.cwd(), 'temp', 'web_cache');
const CACHE_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const URL_REGEX = /https?:\/\/[^\s<>"']+/i;

const PLATFORM_CONFIG = {
    instagram: { api: 'igdl', hosts: ['instagram.com'], ytdlp: true },
    tiktok: { api: 'ttdl', hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'], ytdlp: true },
    facebook: { api: 'fbdown', hosts: ['facebook.com', 'fb.watch'], ytdlp: true },
    twitter: { api: 'twitter', hosts: ['twitter.com', 'x.com', 't.co'], ytdlp: true },
    youtube: { api: 'youtube', hosts: ['youtube.com', 'youtu.be'], ytdlp: true },
    capcut: { api: 'capcut', hosts: ['capcut.com', 'capcut.net'], ytdlp: false },
    pinterest: { api: 'pinterest', hosts: ['pinterest.com', 'pin.it'], ytdlp: false },
    gdrive: { api: 'gdrive', hosts: ['drive.google.com'], ytdlp: false },
    mediafire: { api: 'mediafire', hosts: ['mediafire.com'], ytdlp: false },
    douyin: { api: 'douyin', hosts: ['douyin.com', 'v.douyin.com'], ytdlp: false },
    snackvideo: { api: 'snackvideo', hosts: ['snackvideo.com', 's.snackvideo.com'], ytdlp: false },
    xiaohongshu: { api: 'rednote', hosts: ['xiaohongshu.com', 'xhslink.com'], ytdlp: false },
    cocofun: { api: 'cocofun', hosts: ['icocofun.com', 'cocofun.com'], ytdlp: false },
    spotify: { api: 'spotify', hosts: ['open.spotify.com', 'spotify.link'], ytdlp: false },
    soundcloud: { api: 'soundcloud', hosts: ['soundcloud.com'], ytdlp: false },
    threads: { api: 'threads', hosts: ['threads.net'], ytdlp: false },
    kuaishou: { api: 'kuaishou', hosts: ['kuaishou.com', 'v.kuaishou.com'], ytdlp: false },
    reddit: { api: null, hosts: ['reddit.com', 'redd.it'], ytdlp: true },
    google: { api: null, hosts: ['google.com'], ytdlp: true }
};

const YTDLP_PLATFORMS = new Set(Object.entries(PLATFORM_CONFIG).filter(([, c]) => c.ytdlp).map(([k]) => k));
const BTCH_PLATFORMS = new Set(Object.entries(PLATFORM_CONFIG).filter(([, c]) => c.api).map(([k]) => k));

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

const cookiesPath = path.join(process.cwd(), 'cookies.txt');
const hasCookies = fs.existsSync(cookiesPath);
const BTCH_BASE_URL = 'https://backend1.tioo.eu.org';

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

const axios = require('axios');

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
    console.log(`[WEB-DL] ${platform} downloading via btch-downloader...`);
    try {
        const data = await callBtchApi(cfg.api, url);
        const results = [];
        const dl = (mediaUrl, idx = 0) => {
            if (!mediaUrl) return null;
            const ext = path.extname(new URL(mediaUrl).pathname) || '.mp4';
            const dest = path.join(CACHE_DIR, `webdl_${id}_btch_${idx}${ext}`);
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
            const arr = data?.video || [];
            for (let i = 0; i < arr.length; i++) {
                const item = dl(arr[i], i);
                if (!item) continue;
                await downloadFromUrl(item.url, item.dest);
                results.push(item.dest);
            }
        } else if (platform === 'facebook') {
            const fbUrl = data?.HD || data?.Normal_video || data?.Normal;
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
            const vidUrl = data?.mp4 || data?.mp3;
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
            const item = dl(links[0]?.url, 0);
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
                    const item = dl(downloads[i]?.url, i);
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
        console.log(`[WEB-DL] ${platform} btch falhou: ${e.message}`);
        return [];
    }
}

function findDownloadedFiles(id) {
    try {
        const files = fs.readdirSync(CACHE_DIR)
            .filter(f => f.startsWith(`webdl_${id}_`) && /\.(mp4|webm|mkv|m4a|mp3|jpg|jpeg|png|gif|webp)$/i.test(f) && !f.endsWith('.part'))
            .map(f => ({
                path: path.join(CACHE_DIR, f),
                time: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs,
                size: fs.statSync(path.join(CACHE_DIR, f)).size,
                name: f
            }))
            .filter(f => f.size >= 1024)
            .sort((a, b) => a.time - b.time);

        return files.map(f => f.path);
    } catch (_) {
        return [];
    }
}

function getFileMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
        '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
        '.pdf': 'application/pdf', '.zip': 'application/zip'
    };
    return mime[ext] || 'application/octet-stream';
}

const cacheIndex = new Map();

function registerCacheEntry(filename, url) {
    cacheIndex.set(filename, { url, cachedAt: Date.now() });
}

function getCachedFile(url) {
    for (const [filename, entry] of cacheIndex) {
        if (entry.url === url) {
            const filePath = path.join(CACHE_DIR, filename);
            if (fs.existsSync(filePath)) {
                return { filename, filePath, mime: getFileMime(filePath), size: fs.statSync(filePath).size };
            }
        }
    }
    return null;
}

async function downloadMedia(url, hd = false) {
    const cached = getCachedFile(url);
    if (cached) {
        return { cached: true, ...cached };
    }

    const platform = getPlatform(url);
    if (!platform) {
        throw new Error('URL não suportada');
    }

    const id = crypto.randomBytes(4).toString('hex');
    let allFiles = [];

    if (BTCH_PLATFORMS.has(platform)) {
        allFiles = await downloadBtch(platform, url, id, hd);
    }

    if (allFiles.length === 0 && YTDLP_PLATFORMS.has(platform)) {
        console.log(`[WEB-DL] ${platform} via yt-dlp...`);
        const template = path.join(CACHE_DIR, `webdl_${id}_%(playlist_index|)s%(playlist_index&_|)s%(id)s.%(ext)s`);

        let result = await runYtDlp(buildYtDlpArgs(url, platform, hd, template));
        allFiles = findDownloadedFiles(id);

        if (allFiles.length === 0 && platform === 'instagram' && !hasCookies) {
            for (const browser of ['chrome', 'brave', 'firefox', 'edge']) {
                console.log(`[WEB-DL] Instagram retry --cookies-from-browser ${browser}...`);
                const retryArgs = buildYtDlpArgs(url, platform, hd, template);
                retryArgs.splice(retryArgs.indexOf('--add-header'), 0, '--cookies-from-browser', browser);
                result = await runYtDlp(retryArgs, 60000);
                allFiles = findDownloadedFiles(id);
                if (allFiles.length > 0) break;
            }
        }

        if (allFiles.length === 0 && platform === 'instagram') {
            const retryArgs = buildYtDlpArgs(url, platform, hd, template);
            retryArgs.splice(retryArgs.indexOf('--add-header'), 0, '--yes-playlist', '--extractor-args', 'instagram:allow_direct_url=True');
            result = await runYtDlp(retryArgs);
            allFiles = findDownloadedFiles(id);
        }
    }

    if (allFiles.length === 0 && platform === 'instagram') {
        throw new Error('Instagram bloqueou o acesso. Use cookies.txt na raiz do bot.');
    }

    if (allFiles.length === 0) {
        throw new Error('Não foi possível baixar a mídia.');
    }

    const totalSize = allFiles.reduce((acc, f) => acc + fs.statSync(f).size, 0);
    if (totalSize > 100 * 1024 * 1024) {
        for (const f of allFiles) { try { fs.unlinkSync(f); } catch (_) {} }
        throw new Error(`Limite de 100MB excedido (${(totalSize / 1048576).toFixed(2)}MB).`);
    }

    const results = [];
    for (const filePath of allFiles) {
        const filename = path.basename(filePath);
        registerCacheEntry(filename, url);
        results.push({
            filename,
            filePath,
            mime: getFileMime(filePath),
            size: fs.statSync(filePath).size,
            platform
        });
    }

    return { cached: false, files: results };
}

function getCacheStats() {
    const entries = [];
    try {
        const files = fs.readdirSync(CACHE_DIR);
        for (const f of files) {
            const full = path.join(CACHE_DIR, f);
            if (f.startsWith('webdl_') && fs.statSync(full).isFile()) {
                entries.push({
                    name: f,
                    size: fs.statSync(full).size,
                    mtime: fs.statSync(full).mtimeMs
                });
            }
        }
    } catch (_) {}
    return entries;
}

function cleanupCache() {
    try {
        const files = fs.readdirSync(CACHE_DIR);
        const now = Date.now();
        let removed = 0;
        for (const f of files) {
            const full = path.join(CACHE_DIR, f);
            if (!f.startsWith('webdl_') || !fs.statSync(full).isFile()) continue;
            if (now - fs.statSync(full).mtimeMs > CACHE_TTL_MS) {
                try { fs.unlinkSync(full); removed++; } catch (_) {}
            }
        }
        if (removed > 0) console.log(`[WEB-DL] cache cleanup: ${removed} arquivo(s) removido(s)`);
    } catch (_) {}
}

setInterval(cleanupCache, CLEANUP_INTERVAL_MS);

module.exports = {
    downloadMedia,
    getCacheStats,
    extractUrl,
    getPlatform,
    getFileMime,
    CACHE_DIR
};
