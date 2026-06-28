const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

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
    spotify: { api: 'spotify', hosts: ['open.spotify.com', 'spotify.link'], ytdlp: false },
    soundcloud: { api: 'soundcloud', hosts: ['soundcloud.com'], ytdlp: false },
    threads: { api: 'threads', hosts: ['threads.net'], ytdlp: false },
    kuaishou: { api: 'kuaishou', hosts: ['kuaishou.com', 'v.kuaishou.com'], ytdlp: false },
    reddit: { api: null, hosts: ['reddit.com', 'redd.it'], ytdlp: true },
    google: { api: null, hosts: ['google.com'], ytdlp: true }
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

function getFormatSelector(platform, hd) {
    if (platform === 'instagram') {
        return hd ? 'best[height<=720]/best' : 'worst[height<=480]/worst';
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

const MIME_MAP = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
    '.pdf': 'application/pdf', '.zip': 'application/zip'
};

function getFileMime(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
}

describe('extractUrl', () => {
    it('deve extrair URL simples', () => {
        assert.strictEqual(extractUrl('https://example.com/video'), 'https://example.com/video');
    });

    it('deve extrair URL do meio do texto', () => {
        assert.strictEqual(extractUrl('veja isso https://tiktok.com/@user/video/123 incrivel'), 'https://tiktok.com/@user/video/123');
    });

    it('deve remover pontuação no final', () => {
        assert.strictEqual(extractUrl('link: https://youtu.be/abc123.'), 'https://youtu.be/abc123');
        assert.strictEqual(extractUrl('https://x.com/user/status/123,'), 'https://x.com/user/status/123');
    });

    it('deve retornar null para texto sem URL', () => {
        assert.strictEqual(extractUrl('apenas texto'), null);
    });

    it('deve retornar null para entrada vazia', () => {
        assert.strictEqual(extractUrl(''), null);
        assert.strictEqual(extractUrl(null), null);
        assert.strictEqual(extractUrl(undefined), null);
    });

    it('deve extrair URL com caracteres especiais', () => {
        const url = 'https://vt.tiktok.com/ZSCBrb2m6/';
        assert.strictEqual(extractUrl(url), url);
    });
});

describe('getPlatform', () => {
    it('deve detectar Instagram', () => {
        assert.strictEqual(getPlatform('https://instagram.com/reel/abc123/'), 'instagram');
        assert.strictEqual(getPlatform('https://www.instagram.com/p/xyz/'), 'instagram');
    });

    it('deve detectar TikTok', () => {
        assert.strictEqual(getPlatform('https://tiktok.com/@user/video/123'), 'tiktok');
        assert.strictEqual(getPlatform('https://vm.tiktok.com/abc123/'), 'tiktok');
        assert.strictEqual(getPlatform('https://vt.tiktok.com/ZSCBrb2m6/'), 'tiktok');
    });

    it('deve detectar YouTube', () => {
        assert.strictEqual(getPlatform('https://youtube.com/watch?v=abc'), 'youtube');
        assert.strictEqual(getPlatform('https://youtu.be/abc123'), 'youtube');
        assert.strictEqual(getPlatform('https://www.youtube.com/shorts/abc'), 'youtube');
    });

    it('deve detectar Facebook', () => {
        assert.strictEqual(getPlatform('https://facebook.com/watch?v=123'), 'facebook');
        assert.strictEqual(getPlatform('https://fb.watch/abc/'), 'facebook');
    });

    it('deve detectar Twitter/X', () => {
        assert.strictEqual(getPlatform('https://twitter.com/user/status/123'), 'twitter');
        assert.strictEqual(getPlatform('https://x.com/user/status/123'), 'twitter');
        assert.strictEqual(getPlatform('https://t.co/abc123'), 'twitter');
    });

    it('deve detectar Spotify', () => {
        assert.strictEqual(getPlatform('https://open.spotify.com/track/123'), 'spotify');
        assert.strictEqual(getPlatform('https://spotify.link/abc123'), 'spotify');
    });

    it('deve detectar SoundCloud', () => {
        assert.strictEqual(getPlatform('https://soundcloud.com/artist/track'), 'soundcloud');
    });

    it('deve detectar Pinterest', () => {
        assert.strictEqual(getPlatform('https://pinterest.com/pin/123'), 'pinterest');
        assert.strictEqual(getPlatform('https://pin.it/abc123'), 'pinterest');
    });

    it('deve detectar Google Drive', () => {
        assert.strictEqual(getPlatform('https://drive.google.com/file/d/123/view'), 'gdrive');
    });

    it('deve detectar MediaFire', () => {
        assert.strictEqual(getPlatform('https://mediafire.com/file/abc'), 'mediafire');
    });

    it('deve detectar CapCut', () => {
        assert.strictEqual(getPlatform('https://capcut.com/template/123'), 'capcut');
    });

    it('deve detectar Reddit', () => {
        assert.strictEqual(getPlatform('https://reddit.com/r/subreddit/post/123'), 'reddit');
        assert.strictEqual(getPlatform('https://redd.it/abc123'), 'reddit');
    });

    it('deve detectar Threads', () => {
        assert.strictEqual(getPlatform('https://threads.net/@user/post/123'), 'threads');
    });

    it('deve detectar Kuaishou', () => {
        assert.strictEqual(getPlatform('https://kuaishou.com/video/123'), 'kuaishou');
        assert.strictEqual(getPlatform('https://v.kuaishou.com/abc'), 'kuaishou');
    });

    it('deve detectar Douyin', () => {
        assert.strictEqual(getPlatform('https://douyin.com/video/123'), 'douyin');
        assert.strictEqual(getPlatform('https://v.douyin.com/abc/'), 'douyin');
    });

    it('deve retornar null para URL inválida', () => {
        assert.strictEqual(getPlatform(''), null);
        assert.strictEqual(getPlatform('not-a-url'), null);
    });

    it('deve retornar null para plataforma não suportada', () => {
        assert.strictEqual(getPlatform('https://vimeo.com/123'), null);
        assert.strictEqual(getPlatform('https://dailymotion.com/video/abc'), null);
    });
});

describe('getFormatSelector', () => {
    it('Instagram HD vs normal', () => {
        assert.match(getFormatSelector('instagram', true), /720/);
        assert.match(getFormatSelector('instagram', false), /480/);
    });

    it('TikTok HD vs normal', () => {
        assert.match(getFormatSelector('tiktok', true), /bestvideo/);
        assert.match(getFormatSelector('tiktok', false), /worstvideo/);
    });

    it('Facebook HD vs normal', () => {
        assert.match(getFormatSelector('facebook', true), /bestvideo/);
        assert.match(getFormatSelector('facebook', false), /worst/);
    });

    it('Twitter HD vs normal', () => {
        assert.match(getFormatSelector('twitter', true), /bestvideo/);
        assert.match(getFormatSelector('twitter', false), /worstvideo/);
    });

    it('fallback para outras plataformas', () => {
        assert.match(getFormatSelector('reddit', true), /bestvideo/);
        assert.match(getFormatSelector('reddit', false), /worstvideo/);
    });
});

describe('getFileMime', () => {
    it('deve mapear extensões de vídeo', () => {
        assert.strictEqual(getFileMime('video.mp4'), 'video/mp4');
        assert.strictEqual(getFileMime('video.webm'), 'video/webm');
        assert.strictEqual(getFileMime('video.mkv'), 'video/x-matroska');
    });

    it('deve mapear extensões de imagem', () => {
        assert.strictEqual(getFileMime('foto.jpg'), 'image/jpeg');
        assert.strictEqual(getFileMime('foto.jpeg'), 'image/jpeg');
        assert.strictEqual(getFileMime('foto.png'), 'image/png');
        assert.strictEqual(getFileMime('foto.gif'), 'image/gif');
        assert.strictEqual(getFileMime('foto.webp'), 'image/webp');
    });

    it('deve mapear extensões de áudio', () => {
        assert.strictEqual(getFileMime('audio.mp3'), 'audio/mpeg');
        assert.strictEqual(getFileMime('audio.m4a'), 'audio/mp4');
        assert.strictEqual(getFileMime('audio.ogg'), 'audio/ogg');
        assert.strictEqual(getFileMime('audio.wav'), 'audio/wav');
    });

    it('deve mapear extensões de documento', () => {
        assert.strictEqual(getFileMime('doc.pdf'), 'application/pdf');
        assert.strictEqual(getFileMime('archive.zip'), 'application/zip');
    });

    it('deve retornar fallback para extensão desconhecida', () => {
        assert.strictEqual(getFileMime('arquivo.xyz'), 'application/octet-stream');
    });

    it('deve tratar caminhos completos', () => {
        assert.strictEqual(getFileMime('/cache/webdl_abc_0.mp4'), 'video/mp4');
    });
});
