const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

const URL_REGEX = /https?:\/\/[^\s<>"']+/i;
const BTCH_BASE_URL = 'https://backend1.tioo.eu.org';

const PLATFORM_CONFIG = {
    instagram: { api: 'igdl', hosts: ['instagram.com'], domains: ['instagram.com'], ytdlp: true },
    tiktok: { api: 'ttdl', hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'], ytdlp: true },
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

const YTDLP_PLATFORMS = new Set(Object.entries(PLATFORM_CONFIG).filter(([, c]) => c.ytdlp).map(([k]) => k));
const BTCH_PLATFORMS = new Set(Object.entries(PLATFORM_CONFIG).filter(([, c]) => c.api).map(([k]) => k));

function getExtFromContentType(ct) {
    if (!ct) return null;
    ct = String(ct).toLowerCase().split(';')[0].trim();
    const map = {
        'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
        'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4',
        'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-matroska': '.mkv',
        'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg'
    };
    return map[ct] || null;
}

function sniffExtFromFile(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(16);
        const read = fs.readSync(fd, buf, 0, 16, 0);
        fs.closeSync(fd);
        if (read < 4) return null;
        if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
        if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return '.png';
        if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return '.gif';
        if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return '.webp';
        const head = buf.toString('utf8', 4, 12);
        if (head.includes('ftyp')) return '.mp4';
        if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return '.mkv';
    } catch (_) {}
    return null;
}

function correctFileExtension(filePath, contentType) {
    try {
        if (!fs.existsSync(filePath)) return filePath;
        const currentExt = path.extname(filePath).toLowerCase();
        let correctExt = getExtFromContentType(contentType);
        if (!correctExt) correctExt = sniffExtFromFile(filePath);
        if (!correctExt) return filePath;
        if (currentExt === correctExt) return filePath;
        const isImageExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(correctExt);
        const isVideoExt = ['.mp4', '.webm', '.mkv', '.mov'].includes(currentExt);
        if (isVideoExt && isImageExt) {
            const newPath = filePath.replace(/\.[^.]+$/, '') + correctExt;
            if (filePath !== newPath) { try { fs.renameSync(filePath, newPath); } catch (_) { return filePath; } return newPath; }
        }
        if (correctExt && currentExt !== correctExt) {
            const sniff = sniffExtFromFile(filePath);
            if (sniff && sniff !== currentExt) {
                const newPath = filePath.replace(/\.[^.]+$/, '') + sniff;
                try { fs.renameSync(filePath, newPath); } catch (_) { return filePath; }
                return newPath;
            }
        }
        return filePath;
    } catch (_) { return filePath; }
}

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
    } catch (_) { return null; }
}

function normalizeLang(lang) {
    if (!lang) return null;
    const l = String(lang).trim().toLowerCase();
    if (!l || l === 'original' || l === 'orig' || l === 'auto') return null;
    if (l === 'ptbr' || l === 'pt-br' || l === 'pt_br') return 'pt';
    if (/^[a-z]{2,3}([-_][a-z0-9]{2,4})?$/i.test(l)) return l.split(/[-_]/)[0];
    return null;
}

function parseLangFromText(text, url) {
    if (!text || !url) return null;
    const idx = text.indexOf(url);
    if (idx === -1) return null;
    const after = text.slice(idx + url.length).trim();
    if (!after) return null;
    const tokens = after.split(/\s+/).filter(Boolean);
    if (!tokens.length) return null;
    const last = tokens[tokens.length - 1].toLowerCase();
    if (['original', 'orig', 'auto'].includes(last)) return null;
    if (['pt', 'ptbr', 'pt-br', 'pt_br'].includes(last)) return 'pt';
    if (/^[a-z]{2,3}$/i.test(last) && ['en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'pt', 'ru', 'hi', 'ar', 'zh', 'nl', 'pl', 'tr'].includes(last)) return last;
    if (/^[a-z]{2,3}[-_][a-z]{2,4}$/i.test(last)) return last.split(/[-_]/)[0];
    return null;
}

function parseLangFromQuery(q) {
    if (!q) return { query: q, lang: 'pt' };
    const tokens = q.trim().split(/\s+/);
    if (tokens.length < 2) return { query: q, lang: 'pt' };
    const last = tokens[tokens.length - 1].toLowerCase();
    if (['original', 'orig', 'auto'].includes(last)) return { query: tokens.slice(0, -1).join(' ').trim() || q, lang: null };
    if (['pt', 'ptbr', 'pt-br', 'pt_br'].includes(last)) return { query: tokens.slice(0, -1).join(' ').trim(), lang: 'pt' };
    if (/^[a-z]{2,3}$/i.test(last) && ['en','es','fr','de','it','ja','ko','ru','hi','ar','zh','nl','pl','tr'].includes(last)) return { query: tokens.slice(0, -1).join(' ').trim(), lang: last };
    if (/^[a-z]{2,3}[-_][a-z]{2,4}$/i.test(last)) return { query: tokens.slice(0, -1).join(' ').trim(), lang: last.split(/[-_]/)[0] };
    return { query: q, lang: 'pt' };
}

function getFormatSelector(platform, hd, lang = null) {
    const normLang = normalizeLang(lang);
    if (platform === 'instagram') return hd ? 'best[height<=1080]/best' : 'best[height<=720]/best';
    if (platform === 'tiktok') return hd ? 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best' : 'worstvideo[ext=mp4]+bestaudio[ext=m4a]/worst[ext=mp4]/worst';
    if (platform === 'facebook') return hd ? 'bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best' : 'worst[ext=mp4]/worst';
    if (platform === 'twitter') return hd ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best' : 'worstvideo[ext=mp4]+bestaudio[ext=m4a]/worst[ext=mp4]/worst/best[width<=640]';
    if (normLang && platform === 'youtube') {
        const langFilter = `[language^=${normLang}]`;
        return hd
            ? `bestvideo[ext=mp4][vcodec^=avc1][width<=1080]+bestaudio${langFilter}/bestvideo[ext=mp4][vcodec^=avc1][height<=1080]+bestaudio${langFilter}/bestvideo[ext=mp4][width<=1080]+bestaudio[ext=m4a]/bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[width<=1080][ext=mp4]/best[height<=1080][ext=mp4]/best`
            : `bestvideo[ext=mp4][vcodec^=avc1][width<=720]+bestaudio${langFilter}/bestvideo[ext=mp4][vcodec^=avc1][height<=720]+bestaudio${langFilter}/bestvideo[ext=mp4][width<=720]+bestaudio[ext=m4a]/bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[width<=720][ext=mp4]/best[height<=720][ext=mp4]/best`;
    }
    return hd
        ? 'bestvideo[ext=mp4][vcodec^=avc1][width<=1080]+bestaudio[ext=m4a]/bestvideo[ext=mp4][vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]/best[width<=1080][ext=mp4]/best[height<=1080][ext=mp4]/best'
        : 'bestvideo[ext=mp4][vcodec^=avc1][width<=720]+bestaudio[ext=m4a]/bestvideo[ext=mp4][vcodec^=avc1][height<=720]+bestaudio[ext=m4a]/best[width<=720][ext=mp4]/best[height<=720][ext=mp4]/best';
}

function buildYtDlpArgs(url, platform, hd, outTemplate, lang = null, extraOpts = {}) {
    const normLang = normalizeLang(lang);
    const extractorArgsParts = ['tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com'];
    if (normLang && platform === 'youtube') extractorArgsParts.push(`youtube:lang=${normLang}`);
    const args = [
        '--no-warnings', '--no-check-certificates', '--ignore-errors', '--no-abort-on-error',
        '--retries', '5', '--fragment-retries', '5', '--concurrent-fragments', '4',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        '--extractor-args', extractorArgsParts.join(';'),
        '-f', getFormatSelector(platform, hd, normLang),
        '--merge-output-format', 'mp4',
        '-o', outTemplate
    ];
    if (extraOpts.writeThumbnail) args.push('--write-thumbnail', '--convert-thumbnail', 'png');
    if (platform === 'instagram') args.push('--add-header', 'Referer:https://www.instagram.com/');
    else if (platform === 'twitter') { args.push('--yes-playlist'); args.push('--add-header', 'Referer:https://x.com/'); args.push('--add-header', 'Origin:https://x.com'); }
    else args.push('--no-playlist');
    if (extraOpts.cookiesPath) args.push('--cookies', extraOpts.cookiesPath);
    args.push(url);
    return args;
}

function runYtDlp(args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', args, { shell: false, windowsHide: true });
        let stdout = '', stderr = '';
        const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} reject(new Error(`yt-dlp timeout após ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('error', err => { clearTimeout(timer); reject(err); });
        proc.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
}

async function callBtchApi(endpoint, url) {
    const apiUrl = `${BTCH_BASE_URL}/${endpoint}?url=` + encodeURIComponent(url);
    const res = await axios.get(apiUrl, { headers: { 'User-Agent': 'btch/6.0.36', 'X-Client-Version': '6.0.36' }, timeout: 30000 });
    if (res.status !== 200) throw new Error(`API HTTP ${res.status}`);
    return res.data;
}

function getMaxDownloadBytes() {
    try {
        const { readConfig } = require('../database/utils');
        const cfg = readConfig();
        const mb = Number(cfg.maxDownloadSizeMB);
        if (Number.isFinite(mb) && mb > 0) return Math.max(1, Math.min(500, Math.floor(mb))) * 1024 * 1024;
    } catch (_) {}
    return 100 * 1024 * 1024;
}

async function downloadFromUrl(fileUrl, destPath) {
    const maxBytes = getMaxDownloadBytes();
    if (!/^https?:\/\//i.test(fileUrl)) throw new Error('URL inválida');
    const writer = fs.createWriteStream(destPath);
    let contentType = null;
    try {
        const res = await axios({ url: fileUrl, method: 'GET', responseType: 'stream', timeout: 120000, maxContentLength: maxBytes, maxBodyLength: maxBytes });
        contentType = res.headers ? (res.headers['content-type'] || res.headers['Content-Type'] || null) : null;
        let total = 0;
        res.data.on('data', c => { total += c.length; if (total > maxBytes) { try { res.data.destroy(); writer.destroy(); } catch (_) {} } });
        res.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); res.data.on('error', reject); });
        try { if (fs.statSync(destPath).size > maxBytes) throw new Error(`Arquivo >${Math.round(maxBytes/1024/1024)}MB`); } catch (e) { if (e.message.includes('MB')) throw e; }
    } catch (e) { try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch (_) {} throw e; }
    try { const corrected = correctFileExtension(destPath, contentType); if (corrected !== destPath) return corrected; } catch (_) {}
    return destPath;
}

function parseDurationToSeconds(d) {
    if (typeof d === 'number' && Number.isFinite(d)) return d;
    if (typeof d === 'string') {
        const parts = d.split(':').map(Number);
        if (parts.some(isNaN)) return 0;
        if (parts.length === 3) return parts[0]*3600+parts[1]*60+parts[2];
        if (parts.length === 2) return parts[0]*60+parts[1];
        if (parts.length === 1) return parts[0];
    }
    return 0;
}

async function searchYouTube(query) {
    const q = String(query || '').trim();
    if (!q) return null;
    // tenta yt-search primeiro
    try {
        const yts = require('yt-search');
        const r = await yts(q);
        const v = r?.videos?.[0];
        if (v && v.url) return { id: v.videoId || v.id, url: v.url, title: v.title || 'sem título', seconds: parseDurationToSeconds(v.seconds ?? v.duration), source: 'yt-search' };
    } catch (_) {}
    // fallback yt-dlp
    try {
        const proc = spawn('yt-dlp', ['--no-warnings', '--flat-playlist', '--print', '%(id)s|%(title)s|%(duration)s', `ytsearch1:${q}`], { windowsHide: true });
        let out = '';
        const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) {} }, 20000);
        proc.stdout.on('data', d => { out += d.toString(); });
        await new Promise((resolve) => { proc.on('error', () => { clearTimeout(timer); resolve(); }); proc.on('close', () => { clearTimeout(timer); resolve(); }); });
        const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
        if (!line) return null;
        const f = line.split('|');
        const id = f[0];
        if (!id || id === 'NA') return null;
        const title = f.length > 2 ? f.slice(1, -1).join('|') || 'sem título' : 'sem título';
        const seconds = Number(f[f.length - 1]) || 0;
        return { id, url: `https://www.youtube.com/watch?v=${id}`, title, seconds, source: 'yt-dlp' };
    } catch (_) { return null; }
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

function findDownloadedFiles(dir, prefix, id) {
    try {
        const files = fs.readdirSync(dir)
            .filter(f => f.startsWith(`${prefix}${id}_`) && /\.(mp4|webm|mkv|m4a|mp3|jpg|jpeg|png|gif|webp)$/i.test(f) && !/\.part(\.|$)/i.test(f) && !f.endsWith('.ytdl') && !f.endsWith('.temp.mp4'))
            .map(f => {
                try { const full = path.join(dir, f); const stat = fs.statSync(full); return { path: full, time: stat.mtimeMs, size: stat.size, name: f }; } catch (_) { return null; }
            }).filter(Boolean).filter(f => f.size >= 1024).sort((a, b) => a.time - b.time);
        return files.map(f => f.path);
    } catch (_) { return []; }
}

module.exports = {
    URL_REGEX, BTCH_BASE_URL, PLATFORM_CONFIG, YTDLP_PLATFORMS, BTCH_PLATFORMS,
    getExtFromContentType, sniffExtFromFile, correctFileExtension,
    extractUrl, getPlatform, normalizeLang, parseLangFromText, parseLangFromQuery,
    getFormatSelector, buildYtDlpArgs, runYtDlp, callBtchApi, downloadFromUrl,
    getFileMime, findDownloadedFiles, getMaxDownloadBytes, searchYouTube, parseDurationToSeconds
};
