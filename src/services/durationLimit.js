const { spawn } = require('child_process');
const { readConfig } = require('../database/utils');

const DEFAULT_MAX_DURATION_SECONDS = 900;

function getMaxDurationSeconds() {
    try {
        const cfg = readConfig();
        const v = Number(cfg?.maxMediaDurationSeconds);
        if (Number.isFinite(v) && v > 0) return v;
    } catch (_) {}
    return DEFAULT_MAX_DURATION_SECONDS;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '?';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function fetchYouTubeDuration(url, cookiesPath) {
    return new Promise((resolve) => {
        try {
            const args = [
                '--no-warnings',
                '--no-playlist',
                '--ignore-errors',
                '--no-abort-on-error',
                '--extractor-args', 'youtube:player_client=default,web_safari',
                '--print', '%(duration)s||%(title)s',
                ...(cookiesPath ? ['--cookies', cookiesPath] : []),
                url
            ];
            const proc = spawn('yt-dlp', args, { shell: false, windowsHide: true });
            const chunks = [];
            const errChunks = [];
            const timer = setTimeout(() => {
                try { proc.kill('SIGKILL'); } catch (_) {}
                resolve({ seconds: null, title: null, error: 'timeout' });
            }, 15000);

            proc.stdout.on('data', d => chunks.push(d));
            proc.stderr.on('data', d => errChunks.push(d));
            proc.on('error', () => { clearTimeout(timer); resolve({ seconds: null, title: null, error: 'spawn-failed' }); });
            proc.on('close', () => {
                clearTimeout(timer);
                const out = Buffer.concat(chunks).toString('utf8').trim();
                if (!out) { resolve({ seconds: null, title: null, error: 'no-output' }); return; }
                const firstLine = out.split(/\r?\n/)[0];
                const parts = firstLine.split('||');
                const seconds = parseFloat(parts[0]);
                const title = (parts[1] || '').trim();
                if (!Number.isFinite(seconds) || seconds <= 0) {
                    resolve({ seconds: null, title: title || null, error: 'unknown-duration' });
                    return;
                }
                resolve({ seconds, title, error: null });
            });
        } catch (_) {
            resolve({ seconds: null, title: null, error: 'exception' });
        }
    });
}

function buildDurationErrorMessage({ url, seconds, title, platform, maxSeconds }) {
    const durTxt = formatDuration(seconds || 0);
    const titleTxt = title || url;
    const maxTxt = formatDuration(maxSeconds);
    return `⏱️ *Limite de duração excedido!*\n\n` +
        `📌 *!d* (YouTube) baixa no máximo *${maxTxt}* (${maxSeconds}s).\n` +
        `🎬 *Vídeo:* ${titleTxt}\n` +
        `⏰ *Duração:* ${durTxt}\n\n` +
        `💡 ${platform === 'youtube' ? 'Para vídeos longos, baixe em outro app ou peça trechos específicos.' : 'Esta regra vale apenas para YouTube.'}\n` +
        `⚙️ _Limite configurável:_ \`!set maxMediaDurationSeconds <segundos>\``;
}

module.exports = {
    DEFAULT_MAX_DURATION_SECONDS,
    getMaxDurationSeconds,
    formatDuration,
    fetchYouTubeDuration,
    buildDurationErrorMessage
};
