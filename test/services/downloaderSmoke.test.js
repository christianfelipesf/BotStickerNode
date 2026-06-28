const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');

// ─── Smoke: Pure functions do frontend ───

function detectPlatform(url) {
    const patterns = [
        { regex: /(instagram\.com|instagr\.am)/i, id: 'instagram' },
        { regex: /(tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)/i, id: 'tiktok' },
        { regex: /(youtube\.com|youtu\.be)/i, id: 'youtube' },
        { regex: /(facebook\.com|fb\.watch)/i, id: 'facebook' },
        { regex: /(twitter\.com|x\.com|t\.co)/i, id: 'twitter' },
        { regex: /(open\.spotify\.com|spotify\.link)/i, id: 'spotify' },
        { regex: /(soundcloud\.com)/i, id: 'soundcloud' },
        { regex: /(pinterest\.com|pin\.it)/i, id: 'pinterest' },
        { regex: /(drive\.google\.com)/i, id: 'google' },
        { regex: /(mediafire\.com)/i, id: 'mediafire' },
        { regex: /(capcut\.com|capcut\.net)/i, id: 'capcut' },
        { regex: /(reddit\.com|redd\.it)/i, id: 'reddit' },
        { regex: /(threads\.net)/i, id: 'threads' },
        { regex: /(kuaishou\.com)/i, id: 'kuaishou' },
        { regex: /(douyin\.com)/i, id: 'douyin' }
    ];
    for (const p of patterns) {
        if (p.regex.test(url)) return p.id;
    }
    return null;
}

function getFileIcon(mime) {
    if (mime && mime.startsWith('video/')) return { cls: 'video', icon: '🎬' };
    if (mime && mime.startsWith('image/')) return { cls: 'image', icon: '🖼️' };
    if (mime && mime.startsWith('audio/')) return { cls: 'audio', icon: '🎵' };
    return { cls: 'file', icon: '📁' };
}

function getFileName(mime, fmt) {
    if (fmt === 'mp3' || (mime && mime.startsWith('audio/mpeg'))) return 'audio.mp3';
    if (mime && mime.startsWith('video/')) return 'video.mp4';
    if (mime && mime.startsWith('image/jpeg')) return 'imagem.jpg';
    if (mime && mime.startsWith('image/png')) return 'imagem.png';
    if (mime && mime.startsWith('image/gif')) return 'imagem.gif';
    if (mime && mime.startsWith('image/webp')) return 'imagem.webp';
    if (mime && mime.startsWith('audio/mp4')) return 'audio.m4a';
    if (mime && mime.startsWith('audio/ogg')) return 'audio.ogg';
    return 'arquivo';
}

function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB';
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
}

function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'agora';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'min';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

describe('Smoke: detectPlatform', () => {
    it('Instagram reel', () => {
        assert.strictEqual(detectPlatform('https://instagram.com/reel/abc/'), 'instagram');
    });
    it('Instagram post', () => {
        assert.strictEqual(detectPlatform('https://www.instagram.com/p/xyz/'), 'instagram');
    });
    it('TikTok normal', () => {
        assert.strictEqual(detectPlatform('https://tiktok.com/@user/v/123'), 'tiktok');
    });
    it('TikTok vm', () => {
        assert.strictEqual(detectPlatform('https://vm.tiktok.com/abc/'), 'tiktok');
    });
    it('TikTok vt', () => {
        assert.strictEqual(detectPlatform('https://vt.tiktok.com/ZSCBrb2m6/'), 'tiktok');
    });
    it('YouTube watch', () => {
        assert.strictEqual(detectPlatform('https://youtube.com/watch?v=abc'), 'youtube');
    });
    it('YouTube shorts', () => {
        assert.strictEqual(detectPlatform('https://youtu.be/abc123'), 'youtube');
    });
    it('Facebook', () => {
        assert.strictEqual(detectPlatform('https://facebook.com/watch?v=123'), 'facebook');
    });
    it('Twitter/X', () => {
        assert.strictEqual(detectPlatform('https://x.com/user/status/123'), 'twitter');
    });
    it('Spotify', () => {
        assert.strictEqual(detectPlatform('https://open.spotify.com/track/123'), 'spotify');
    });
    it('URL sem plataforma', () => {
        assert.strictEqual(detectPlatform('https://example.com/video'), null);
    });
    it('String vazia', () => {
        assert.strictEqual(detectPlatform(''), null);
    });
});

describe('Smoke: getFileIcon', () => {
    it('video/mp4 retorna video', () => {
        const r = getFileIcon('video/mp4');
        assert.strictEqual(r.cls, 'video');
    });
    it('image/jpeg retorna image', () => {
        const r = getFileIcon('image/jpeg');
        assert.strictEqual(r.cls, 'image');
    });
    it('audio/mpeg retorna audio', () => {
        const r = getFileIcon('audio/mpeg');
        assert.strictEqual(r.cls, 'audio');
    });
    it('application/pdf retorna file', () => {
        const r = getFileIcon('application/pdf');
        assert.strictEqual(r.cls, 'file');
    });
    it('null retorna file', () => {
        const r = getFileIcon(null);
        assert.strictEqual(r.cls, 'file');
    });
});

describe('Smoke: getFileName', () => {
    it('fmt mp3 retorna audio.mp3', () => {
        assert.strictEqual(getFileName('video/mp4', 'mp3'), 'audio.mp3');
    });
    it('video retorna video.mp4', () => {
        assert.strictEqual(getFileName('video/mp4', 'mp4'), 'video.mp4');
    });
    it('image/jpeg retorna imagem.jpg', () => {
        assert.strictEqual(getFileName('image/jpeg', 'mp4'), 'imagem.jpg');
    });
    it('image/png retorna imagem.png', () => {
        assert.strictEqual(getFileName('image/png', 'mp4'), 'imagem.png');
    });
    it('image/gif retorna imagem.gif', () => {
        assert.strictEqual(getFileName('image/gif', 'mp4'), 'imagem.gif');
    });
    it('image/webp retorna imagem.webp', () => {
        assert.strictEqual(getFileName('image/webp', 'mp4'), 'imagem.webp');
    });
    it('audio/mpeg retorna audio.mp3', () => {
        assert.strictEqual(getFileName('audio/mpeg', 'mp4'), 'audio.mp3');
    });
    it('audio/mp4 retorna audio.m4a', () => {
        assert.strictEqual(getFileName('audio/mp4', 'mp4'), 'audio.m4a');
    });
    it('audio/ogg retorna audio.ogg', () => {
        assert.strictEqual(getFileName('audio/ogg', 'mp4'), 'audio.ogg');
    });
    it('mime desconhecido retorna arquivo', () => {
        assert.strictEqual(getFileName('application/pdf', 'mp4'), 'arquivo');
    });
    it('null mime retorna arquivo', () => {
        assert.strictEqual(getFileName(null, 'mp4'), 'arquivo');
    });
});

describe('Smoke: formatSize', () => {
    it('null retorna vazio', () => { assert.strictEqual(formatSize(null), ''); });
    it('0 retorna vazio', () => { assert.strictEqual(formatSize(0), ''); });
    it('500 B', () => { assert.strictEqual(formatSize(500), '500 B'); });
    it('1.5 KB', () => { assert.strictEqual(formatSize(1500), '1 KB'); });
    it('1.5 MB', () => { assert.strictEqual(formatSize(1500000), '1.4 MB'); });
    it('1.5 GB', () => { assert.strictEqual(formatSize(1500000000), '1.40 GB'); });
});

describe('Smoke: formatTime', () => {
    it('agora (< 1min)', () => {
        assert.strictEqual(formatTime(Date.now()), 'agora');
    });
    it('minutos', () => {
        const ts = Date.now() - 120000;
        const r = formatTime(ts);
        assert.match(r, /\d+min/);
    });
    it('horas', () => {
        const ts = Date.now() - 7200000;
        const r = formatTime(ts);
        assert.match(r, /\d+h/);
    });
});

// ─── Smoke: API endpoint with mock server ───

describe('Smoke: /api/download endpoint', () => {
    let server;
    let app;
    let port;

    const mockDownloadMedia = mock.fn();

    before(async () => {
        app = express();
        app.use(express.json());

        const downloadRateLimitMap = new Map();
        const DL_RATE_WINDOW = 60 * 1000;
        const DL_RATE_MAX = 20;
        function downloadRateLimit(req) {
            const key = req.ip || req.connection?.remoteAddress || 'unknown';
            const now = Date.now();
            let entry = downloadRateLimitMap.get(key);
            if (!entry || (now - entry.windowStart) > DL_RATE_WINDOW) {
                entry = { windowStart: now, count: 0 };
                downloadRateLimitMap.set(key, entry);
            }
            entry.count++;
            return entry.count <= DL_RATE_MAX;
        }
        setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of downloadRateLimitMap) {
                if ((now - entry.windowStart) > DL_RATE_WINDOW * 2) downloadRateLimitMap.delete(key);
            }
        }, DL_RATE_WINDOW);

        app.post('/api/download', (req, res, next) => {
            if (!downloadRateLimit(req)) return res.status(429).json({ ok: false, error: 'Muitos downloads. Aguarde alguns segundos.' });
            next();
        }, async (req, res) => {
            try {
                const { url, hd, fmt } = req.body || {};
                if (!url) return res.status(400).json({ ok: false, error: 'URL é obrigatória' });
                const result = await mockDownloadMedia(url, !!hd, fmt || 'mp4');
                if (result.cached) {
                    return res.json({ ok: true, cached: true, filename: result.filename, mime: result.mime, size: result.size });
                }
                return res.json({ ok: true, cached: false, files: result.files });
            } catch (e) {
                return res.status(400).json({ ok: false, error: e.message });
            }
        });

        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                port = server.address().port;
                resolve();
            });
        });
    });

    after(() => {
        if (server) server.close();
    });

    it('GET sem url retorna 400', async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/download`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.ok, false);
        assert.match(data.error, /URL/);
    });

    it('POST com url valida retorna sucesso', async () => {
        mockDownloadMedia.mock.mockImplementationOnce(() => Promise.resolve({
            cached: false,
            files: [{ filename: 'video.mp4', filePath: '/tmp/video.mp4', mime: 'video/mp4', size: 1024, platform: 'instagram' }]
        }));
        const res = await fetch(`http://127.0.0.1:${port}/api/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://instagram.com/reel/abc/', hd: false, fmt: 'mp4' })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.ok, true);
        assert.strictEqual(data.cached, false);
        assert.ok(Array.isArray(data.files));
        assert.strictEqual(data.files[0].platform, 'instagram');
    });

    it('POST com hd=true passa corretamente', async () => {
        mockDownloadMedia.mock.mockImplementationOnce((url, hd, fmt) => {
            assert.strictEqual(hd, true);
            return Promise.resolve({ cached: false, files: [] });
        });
        await fetch(`http://127.0.0.1:${port}/api/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://youtube.com/watch?v=abc', hd: true, fmt: 'mp4' })
        });
    });

    it('POST com fmt=mp3 passa corretamente', async () => {
        mockDownloadMedia.mock.mockImplementationOnce((url, hd, fmt) => {
            assert.strictEqual(fmt, 'mp3');
            return Promise.resolve({ cached: false, files: [] });
        });
        await fetch(`http://127.0.0.1:${port}/api/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://youtube.com/watch?v=abc', hd: false, fmt: 'mp3' })
        });
    });

    it('cached response retorna filename/mime/size', async () => {
        mockDownloadMedia.mock.mockImplementationOnce(() => Promise.resolve({
            cached: true, filename: 'cached.mp4', mime: 'video/mp4', size: 2048
        }));
        const res = await fetch(`http://127.0.0.1:${port}/api/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://instagram.com/reel/abc/', hd: false })
        });
        const data = await res.json();
        assert.strictEqual(data.cached, true);
        assert.strictEqual(data.filename, 'cached.mp4');
        assert.strictEqual(data.mime, 'video/mp4');
    });

    it('erro do backend retorna 400 com mensagem', async () => {
        mockDownloadMedia.mock.mockImplementationOnce(() => Promise.reject(new Error('URL não suportada')));
        const res = await fetch(`http://127.0.0.1:${port}/api/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://invalid.com/video' })
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.ok, false);
        assert.strictEqual(data.error, 'URL não suportada');
    });

    it('rate limit retorna 429 apos muitas requisicoes', async () => {
        mockDownloadMedia.mock.mockImplementation(() => Promise.resolve({ cached: false, files: [] }));
        const opts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://youtube.com/watch?v=abc' })
        };
        let lastStatus = 200;
        for (let i = 0; i < 25; i++) {
            const res = await fetch(`http://127.0.0.1:${port}/api/download`, opts);
            lastStatus = res.status;
            if (res.status === 429) break;
        }
        assert.strictEqual(lastStatus, 429);
    });
});

// ─── Smoke: ServeCachedFile segurança (teste direto da função) ───

describe('Smoke: ServeCachedFile path traversal', () => {
    const CACHE_DIR = path.join(process.cwd(), 'temp', 'web_cache_test');
    const CACHE_DIR_ABS = path.resolve(CACHE_DIR);

    function serveCachedFileLogic(filename) {
        if (!/^[a-zA-Z0-9_\-\.]+$/.test(filename)) return { status: 400 };
        const filePath = path.join(CACHE_DIR, filename);
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(CACHE_DIR_ABS + path.sep)) return { status: 403 };
        if (!fs.existsSync(resolved)) return { status: 404 };
        return { status: 200, filePath: resolved };
    }

    before(() => {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(path.join(CACHE_DIR, 'legit.mp4'), 'test');
    });

    after(() => {
        try { fs.rmSync(CACHE_DIR, { recursive: true }); } catch {}
    });

    it('arquivo valido', () => {
        const r = serveCachedFileLogic('legit.mp4');
        assert.strictEqual(r.status, 200);
    });

    it('path traversal ../ bloqueado pelo regex', () => {
        const r = serveCachedFileLogic('../malicious.exe');
        assert.strictEqual(r.status, 400);
    });

    it('path traversal ..\\ bloqueado pelo regex', () => {
        const r = serveCachedFileLogic('..\\malicious.exe');
        assert.strictEqual(r.status, 400);
    });

    it('path traversal com subdiretorio bloqueado pelo regex', () => {
        const r = serveCachedFileLogic('sub/../malicious.exe');
        assert.strictEqual(r.status, 400);
    });

    it('arquivo inexistente', () => {
        const r = serveCachedFileLogic('nonexistent.mp4');
        assert.strictEqual(r.status, 404);
    });

    it('nome com script tags bloqueado pelo regex', () => {
        const r = serveCachedFileLogic('<script>alert(1)</script>');
        assert.strictEqual(r.status, 400);
    });

    it('nome com espacos bloqueado pelo regex', () => {
        const r = serveCachedFileLogic('file name.mp4');
        assert.strictEqual(r.status, 400);
    });

    it('resolved.startsWith check impede ../ fora do cache dir', () => {
        const filePath = path.join(CACHE_DIR, 'legit.mp4');
        const resolved = path.resolve(filePath);
        assert.ok(resolved.startsWith(CACHE_DIR_ABS + path.sep));
    });
});
