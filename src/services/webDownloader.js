const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readConfig } = require('../database/utils');
const {
    PLATFORM_CONFIG, YTDLP_PLATFORMS, BTCH_PLATFORMS, URL_REGEX,
    extractUrl, getPlatform, normalizeLang, correctFileExtension
} = require('./downloaderCore');
const { getFileMime, findDownloadedFiles: coreFind, downloadFromUrl: coreDownloadFromUrl, callBtchApi: coreCallBtchApi, runYtDlp: coreRunYtDlp, buildYtDlpArgs: coreBuildYtDlpArgs, getFormatSelector } = require('./downloaderCore');

const CACHE_DIR = path.join(process.cwd(), 'temp', 'web_cache');
const CACHE_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const COOKIES_FILE = path.join(process.cwd(), 'cookies.txt');
const CONFIG_COOKIES_FILE = path.join(process.cwd(), 'temp', 'instagram_cookies.txt');

function getCookiesPath() {
    if (fs.existsSync(COOKIES_FILE)) return COOKIES_FILE;
    try {
        const cfg = readConfig();
        if (cfg.instagramCookies && cfg.instagramCookies.trim()) {
            if (cfg.instagramCookies.length > 2 * 1024 * 1024) return null;
            const dir = path.dirname(CONFIG_COOKIES_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CONFIG_COOKIES_FILE, cfg.instagramCookies.slice(0, 1024*1024), 'utf8');
            return CONFIG_COOKIES_FILE;
        }
    } catch (_) {}
    return null;
}

function hasCookies() { return getCookiesPath() !== null; }
const axios = require('axios');
function buildYtDlpArgs(url, platform, hd, outTemplate, lang = null) {
    return coreBuildYtDlpArgs(url, platform, hd, outTemplate, lang, { cookiesPath: hasCookies() ? getCookiesPath() : null, writeThumbnail: true });
}
function runYtDlp(args, timeoutMs = 300000) { return coreRunYtDlp(args, timeoutMs); }
function callBtchApi(endpoint, url) { return coreCallBtchApi(endpoint, url); }
function downloadFromUrl(fileUrl, destPath) { return coreDownloadFromUrl(fileUrl, destPath); }

async function downloadBtch(platform, url, id, hd) {
    const cfg = PLATFORM_CONFIG[platform];
    if (!cfg || !cfg.api) return [];
    console.log(`[WEB-DL] ${platform} downloading via btch-downloader...`);
    try {
        const data = await callBtchApi(cfg.api, url);
        const results = [];
        const dl = (mediaUrl, idx = 0) => {
            if (!mediaUrl) return null;
            try {
                const ext = path.extname(new URL(mediaUrl).pathname) || '.mp4';
                const dest = path.join(CACHE_DIR, `webdl_${id}_btch_${idx}${ext}`);
                return { url: mediaUrl, dest };
            } catch (_) { return null; }
        };

        if (platform === 'instagram') {
            let items = data;
            if (!Array.isArray(items)) {
                items = data?.result || data?.data || data?.medias || null;
                if (!Array.isArray(items)) {
                    if (data?.url) items = [data];
                    else throw new Error('formato de resposta inválido: ' + JSON.stringify(data).slice(0, 200));
                }
            }
            for (let i = 0; i < Math.min(items.length, 10); i++) {
                const mediaUrl = items[i]?.url || (typeof items[i] === 'string' ? items[i] : null);
                if (!mediaUrl) continue;
                const item = dl(mediaUrl, i);
                if (!item) continue;
                item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                results.push(item.dest);
            }
        } else if (platform === 'tiktok') {
            const arr = data?.video || [];
            for (let i = 0; i < arr.length; i++) {
                const item = dl(arr[i], i);
                if (!item) continue;
                item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                results.push(item.dest);
            }
        } else if (platform === 'facebook') {
            const fbUrl = data?.HD || data?.Normal_video || data?.Normal;
            if (!fbUrl) throw new Error('sem mídia');
            const item = dl(fbUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'twitter') {
            if (!data?.url) throw new Error('sem mídia');
            const item = dl(data.url, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'youtube') {
            const vidUrl = data?.mp4 || data?.mp3;
            if (!vidUrl) throw new Error('sem mídia');
            const item = dl(vidUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            try { item.dest = correctFileExtension(item.dest, null); } catch (_) {}
            const ef = path.extname(item.dest).toLowerCase();
            if (['.mp3', '.m4a', '.ogg', '.opus', '.wav'].includes(ef)) {
                try { fs.unlinkSync(item.dest); } catch (_) {}
                throw new Error('btch retornou apenas áudio para youtube');
            }
            results.push(item.dest);
        } else if (platform === 'capcut') {
            if (!data?.originalVideoUrl) throw new Error('sem mídia');
            const item = dl(data.originalVideoUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'pinterest') {
            if (data?.video_url) {
                const item = dl(data.video_url, 0);
                item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                results.push(item.dest);
            } else if (data?.image) {
                const item = dl(data.image, 0);
                item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                results.push(item.dest);
            } else if (data?.result?.length) {
                for (let i = 0; i < Math.min(data.result.length, 5); i++) {
                    const pin = data.result[i];
                    const imgUrl = pin?.video_url || pin?.image_url || pin?.images?.original;
                    if (!imgUrl) continue;
                    const item = dl(imgUrl, i);
                    item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                    results.push(item.dest);
                }
            } else throw new Error('sem mídia');
        } else if (platform === 'gdrive') {
            const dlUrl = data?.result?.downloadUrl || data?.downloadUrl;
            if (!dlUrl) throw new Error('sem mídia');
            const item = dl(dlUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'mediafire') {
            const mfUrl = data?.result?.url || data?.url;
            if (!mfUrl) throw new Error('sem mídia');
            const item = dl(mfUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'douyin') {
            const links = data?.result?.links || data?.links;
            if (!links?.length) throw new Error('sem mídia');
            const item = dl(links[0]?.url, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'snackvideo') {
            const svUrl = data?.result?.videoUrl || data?.videoUrl || data?.url;
            if (!svUrl) throw new Error('sem mídia');
            const item = dl(svUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'xiaohongshu') {
            const downloads = data?.result?.downloads;
            const images = data?.result?.images;
            if (downloads?.length) {
                for (let i = 0; i < downloads.length; i++) {
                    const item = dl(downloads[i]?.url, i);
                    if (!item) continue;
                    item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                    results.push(item.dest);
                }
            } else if (images?.length) {
                for (let i = 0; i < images.length; i++) {
                    const item = dl(images[i], i);
                    item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
                    results.push(item.dest);
                }
            } else throw new Error('sem mídia');
        } else if (platform === 'cocofun') {
            const cfUrl = data?.result?.no_watermark || data?.result?.watermark || data?.no_watermark || data?.watermark;
            if (!cfUrl) throw new Error('sem mídia');
            const item = dl(cfUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'spotify') {
            const formats = data?.result?.formats || data?.formats;
            if (!formats?.length) throw new Error('sem mídia');
            const best = formats.reduce((a, b) => (parseInt(b.quality) || 0) > (parseInt(a.quality) || 0) ? b : a);
            const item = dl(best.url, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'soundcloud') {
            const scUrl = data?.result?.downloadMp3 || data?.result?.audio || data?.downloadMp3 || data?.audio;
            if (!scUrl) throw new Error('sem mídia');
            const item = dl(scUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'threads') {
            const thUrl = data?.result?.video || data?.result?.image || data?.video || data?.image;
            if (!thUrl) throw new Error('sem mídia');
            const item = dl(thUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        } else if (platform === 'kuaishou') {
            const ksUrl = data?.result?.videoUrl || data?.videoUrl;
            if (!ksUrl) throw new Error('sem mídia');
            const item = dl(ksUrl, 0);
            item.dest = await downloadFromUrl(item.url, item.dest) || item.dest;
            results.push(item.dest);
        }

        if (!results.length) throw new Error('nenhuma mídia baixada');
        return results;
    } catch (e) {
        console.log(`[WEB-DL] ${platform} btch falhou: ${e.message}`);
        return [];
    }
}

function findDownloadedFiles(id) { return coreFind(CACHE_DIR, 'webdl_', id); }

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

async function downloadMedia(url, hd = false, fmt = 'mp4', lang) {
    const cached = getCachedFile(url);
    if (cached) {
        return { cached: true, ...cached };
    }

    const platform = getPlatform(url);
    if (!platform) {
        throw new Error('URL não suportada');
    }

    // youtube default: pt (dublagem) com fallback para original; lang=null/original => sem filtro
    let effectiveLang;
    if (platform !== 'youtube') {
        effectiveLang = null;
    } else if (lang === undefined) {
        effectiveLang = 'pt';
    } else if (lang === null) {
        effectiveLang = null;
    } else {
        const n = normalizeLang(lang);
        if (n === null) {
            effectiveLang = /^(original|orig)$/i.test(String(lang).trim()) ? null : 'pt';
        } else {
            effectiveLang = n;
        }
    }

    const id = crypto.randomBytes(4).toString('hex');
    let allFiles = [];
    const isAudio = fmt === 'mp3';
    const preferYtDlp = platform === 'youtube' && !!effectiveLang;

    if (!isAudio && BTCH_PLATFORMS.has(platform) && !preferYtDlp) {
        allFiles = await downloadBtch(platform, url, id, hd);
    }

    if (allFiles.length === 0 && YTDLP_PLATFORMS.has(platform)) {
        console.log(`[WEB-DL] ${platform} via yt-dlp...${effectiveLang ? ` lang=${effectiveLang}` : ''}`);

        if (isAudio) {
            const tmpl = path.join(CACHE_DIR, `webdl_${id}_%(id)s.mp3`);
            const audioFormat = effectiveLang ? `bestaudio[language^=${effectiveLang}]/bestaudio/best` : 'bestaudio/best';
            const extractorArgsParts = [];
            if (effectiveLang) {
                const ytLang = effectiveLang;
                extractorArgsParts.push(`youtube:lang=${ytLang}`);
            }
            const audioArgs = [
                '--no-warnings', '--no-check-certificates', '--ignore-errors', '--no-abort-on-error',
                '--retries', '5', '--fragment-retries', '5', '--concurrent-fragments', '4',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                '-x', '--audio-format', 'mp3', '--audio-quality', '0',
                '-f', audioFormat,
                '-o', tmpl
            ];
            if (extractorArgsParts.length) audioArgs.splice(audioArgs.indexOf('-x'), 0, '--extractor-args', extractorArgsParts.join(';'));
            if (hasCookies()) audioArgs.push('--cookies', getCookiesPath());
            audioArgs.push(url);
            await runYtDlp(audioArgs);
            allFiles = findDownloadedFiles(id);
        } else {
            const template = path.join(CACHE_DIR, `webdl_${id}_%(playlist_index|)s%(playlist_index&_|)s%(id)s.%(ext)s`);
            let result = await runYtDlp(buildYtDlpArgs(url, platform, hd, template, effectiveLang));
            allFiles = findDownloadedFiles(id);

            if (allFiles.length === 0 && platform === 'instagram' && !hasCookies()) {
                for (const browser of ['chrome', 'brave', 'firefox', 'edge']) {
                    console.log(`[WEB-DL] Instagram retry --cookies-from-browser ${browser}...`);
                    const retryArgs = buildYtDlpArgs(url, platform, hd, template, effectiveLang);
                    retryArgs.splice(retryArgs.indexOf('--add-header'), 0, '--cookies-from-browser', browser);
                    result = await runYtDlp(retryArgs, 60000);
                    allFiles = findDownloadedFiles(id);
                    if (allFiles.length > 0) break;
                }
            }

            if (allFiles.length === 0 && platform === 'instagram') {
                const retryArgs = buildYtDlpArgs(url, platform, hd, template, effectiveLang);
                retryArgs.splice(retryArgs.indexOf('--add-header'), 0, '--yes-playlist', '--extractor-args', 'instagram:allow_direct_url=True');
                result = await runYtDlp(retryArgs);
                allFiles = findDownloadedFiles(id);
            }
        }
        // fallback btch para youtube com lang quando yt-dlp falhou (btch perde dublagem mas evita falha total)
        if (allFiles.length === 0 && preferYtDlp && BTCH_PLATFORMS.has(platform) && !isAudio) {
            console.log(`[WEB-DL] ${platform} yt-dlp falhou, tentando btch fallback...`);
            allFiles = await downloadBtch(platform, url, id, hd);
        }
    }

    if (allFiles.length === 0 && platform === 'instagram') {
        throw new Error('Instagram bloqueou o acesso. Defina os cookies do Instagram no Admin > instagramCookies ou coloque cookies.txt na raiz do bot.');
    }

    if (allFiles.length === 0) {
        throw new Error('Não foi possível baixar a mídia.');
    }

    let totalSize = 0;
    try { totalSize = allFiles.reduce((acc, f) => { try { return acc + fs.statSync(f).size; } catch (_) { return acc; } }, 0); } catch (_) {}
    if (totalSize > 100 * 1024 * 1024) {
        for (const f of allFiles) { try { fs.unlinkSync(f); } catch (_) {} }
        throw new Error(`Limite de 100MB excedido (${(totalSize / 1048576).toFixed(2)}MB).`);
    }

    const results = [];
    for (const filePath of allFiles) {
        const filename = path.basename(filePath);
        registerCacheEntry(filename, url);
        const baseName = path.basename(filePath, path.extname(filePath));
        const thumbPath = path.join(CACHE_DIR, baseName + '.png');
        const thumbFilename = fs.existsSync(thumbPath) ? baseName + '.png' : null;
        results.push({
            filename,
            filePath,
            mime: getFileMime(filePath),
            size: fs.statSync(filePath).size,
            platform,
            ...(thumbFilename ? { thumbFilename } : {})
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
            if (!f.startsWith('webdl_')) continue;
            let stat;
            try { stat = fs.statSync(full); } catch { continue; }
            if (!stat.isFile()) continue;
            entries.push({ name: f, size: stat.size, mtime: stat.mtimeMs });
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
            if (!f.startsWith('webdl_')) continue;
            const full = path.join(CACHE_DIR, f);
            let stat;
            try { stat = fs.statSync(full); } catch { continue; }
            if (!stat.isFile()) continue;
            if (now - stat.mtimeMs > CACHE_TTL_MS) {
                try { fs.unlinkSync(full); removed++; } catch (_) {}
            }
        }
        if (removed > 0) console.log(`[WEB-DL] cache cleanup: ${removed} arquivo(s) removido(s)`);
    } catch (_) {}
}

setInterval(cleanupCache, CLEANUP_INTERVAL_MS).unref();

module.exports = {
    downloadMedia,
    getCacheStats,
    extractUrl,
    getPlatform,
    getFileMime,
    CACHE_DIR
};
