const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const cookiesPath = path.join(process.cwd(), 'cookies.txt');
const hasCookies = fs.existsSync(cookiesPath);

const URL_REGEX = /https?:\/\/[^\s<>"']+/i;
const SUPPORTED_HOSTS = [
    'tiktok.com', 'instagram.com', 'youtube.com', 'youtu.be',
    'facebook.com', 'fb.watch', 'reddit.com', 'redd.it', 'google.com'
];

function extractUrl(text) {
    if (!text) return null;
    const match = text.match(URL_REGEX);
    return match ? match[0].replace(/[).,;]+$/, '') : null;
}

function isSupported(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return SUPPORTED_HOSTS.some(h => host === h || host.endsWith('.' + h));
    } catch (e) {
        return false;
    }
}

function getPlatform(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (host.includes('tiktok')) return 'tiktok';
        if (host.includes('instagram')) return 'instagram';
        if (host.includes('youtu')) return 'youtube';
        if (host.includes('facebook') || host.includes('fb.watch')) return 'facebook';
        if (host.includes('reddit') || host.includes('redd.it')) return 'reddit';
        if (host.includes('google')) return 'google';
        return 'desconhecido';
    } catch (e) {
        return 'desconhecido';
    }
}

function getFormatSelector(platform, hd) {
    if (platform === 'instagram') {
        return hd
            ? 'bestvideo+bestaudio/best'
            : 'worstvideo+bestaudio/worst/worst';
    }
    if (platform === 'tiktok') {
        return hd
            ? 'bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best'
            : 'worstvideo[ext=mp4]+bestaudio[ext=m4a]/worst[ext=mp4]/worst';
    }
    if (platform === 'facebook') {
        return hd
            ? 'bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best'
            : 'worst[ext=mp4]/worst';
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
        args.push('--yes-playlist');
        args.push('--extractor-args', 'instagram:allow_direct_url=True');
        args.push('--add-header', 'Referer:https://www.instagram.com/');
    } else {
        args.push('--no-playlist');
    }

    if (hasCookies) {
        args.push('--cookies', cookiesPath);
    }

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
    aliases: ['d', 'dl', 'baixar', 'media', 'social', 'tiktok', 'ttk', 'fb', 'facebook', 'insta', 'instagram', 'reel', 'shorts', 'youtube', 'yt'],
    category: 'mídia',
    description: 'Baixa mídia de TikTok, Instagram, YouTube, Facebook e mais',
    async execute(sock, m, { from, fullArgsText, commandName, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, reactStatus } = utils;
        const hd = commandName === 'downloadhd' || commandName === 'dhd';
        const url = extractUrl(fullArgsText);

        if (!url) {
            await react(sock, m, '❓', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, {
                text: `❌ *Envie um link válido!*\n\n📌 *Uso:* ${hd ? '!dhd' : '!d'} <link>\n\n✅ *Suportado:*\n• TikTok (videos)\n• Instagram (posts/reels/carrosséis)\n• YouTube (videos)\n• Facebook (videos/reels)\n• Reddit (videos/imagens)\n• Google (imagens)`
            }, { quoted: m });
        }

        if (!isSupported(url)) {
            await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, {
                text: `❌ *Site não suportado!*\n\n🔗 Link: ${url}\n\n✅ *Suportado:*\n• tiktok.com\n• instagram.com\n• youtube.com / youtu.be\n• facebook.com / fb.watch\n• reddit.com / redd.it\n• google.com`
            }, { quoted: m });
        }

        const platform = getPlatform(url);
        let currentBotResponse = await react(sock, m, '🔎', lastBotResponse, GLOBAL_COOLDOWN);
        const id = crypto.randomBytes(4).toString('hex');
        const template = path.join(tempDir, `dl_${id}_%(playlist_index|)s%(playlist_index&_|)s%(id)s.%(ext)s`);

        try {
            currentBotResponse = await react(sock, m, '⬇️', currentBotResponse, GLOBAL_COOLDOWN);

            let title = '';
            try {
                const dump = spawn('yt-dlp', [
                    '--no-warnings',
                    '--no-playlist',
                    '--ignore-errors',
                    '--no-abort-on-error',
                    '--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com',
                    '--print', '%(title)s',
                    ...(hasCookies ? ['--cookies', cookiesPath] : []),
                    url
                ], { shell: false, windowsHide: true });
                const chunks = [];
                dump.stdout.on('data', d => chunks.push(d));
                await new Promise((resolve) => {
                    dump.on('error', () => resolve());
                    dump.on('close', () => resolve());
                });
                title = Buffer.concat(chunks).toString('utf8').trim().split('\n')[0];
            } catch (_) { title = '' }

            setTimeout(async () => {
                try { currentBotResponse = await react(sock, m, '🔄', currentBotResponse, GLOBAL_COOLDOWN); } catch (_) {}
            }, 4000);

            const result = await runYtDlp(buildYtDlpArgs(url, platform, hd, template));

            const allFiles = findDownloadedFiles(id);
            if (allFiles.length === 0) {
                let reason = 'Mídia não encontrada ou protegida.';
                if (platform === 'instagram') reason = 'Instagram bloqueou. Tente adicionar cookies.txt na raiz.';
                throw new Error(reason);
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
                const caption = allFiles.length > 1 ? `📎 *${title || 'media'}* (${i + 1}/${allFiles.length}) [${ext}]` : (title || 'media');
                await sendMedia(sock, from, m, filePath, caption);
                try { fs.unlinkSync(filePath); } catch (_) {}
                if (allFiles.length > 1) await new Promise(r => setTimeout(r, 800));
            }

            return await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);

        } catch (e) {
            console.error(`\x1b[31m[DOWNLOAD ERROR]\x1b[0m ${e.message}`);
            if (e.stack) console.error(`\x1b[2m${e.stack.split('\n').slice(1, 3).join('\n')}\x1b[0m`);
            
            const partial = findDownloadedFiles(id);
            for (const f of partial) { try { fs.unlinkSync(f); } catch (_) {} }
            
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, {
                text: `❌ *Falha no Download!*\n\n⚠️ _Este é um recurso experimental e pode falhar devido a proteções das redes sociais._\n\n💬 *Motivo:* ${e.message}\n\n💡 Tente novamente ou use um link diferente.`
            }, { quoted: m });
            return currentBotResponse;
        }
    }
};
