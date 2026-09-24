// ============================================================
// Capa 21:9 da música (!play) estilo !menu: thumb do YouTube de
// fundo + avatar circular + título, duração, fonte e canal.
// ============================================================
const axios = require('axios');
const sharp = require('sharp');

const OUT_W = 1080;
const OUT_H = Math.round(OUT_W * 9 / 21); // 463

function escapeXml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function truncate(s, n) {
    s = String(s || '');
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + '…';
}

function thumbUrlFromVideo(video) {
    try {
        if (!video) return null;
        if (video.thumbnail) return typeof video.thumbnail === 'string' ? video.thumbnail : video.thumbnail.url;
        if (video.image) return typeof video.image === 'string' ? video.image : video.image.url;
        if (video.thumbnails && Array.isArray(video.thumbnails) && video.thumbnails.length) {
            const last = video.thumbnails[video.thumbnails.length - 1];
            if (last && last.url) return last.url;
        }
        if (video.videoId) return `https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`;
        if (video.id) return `https://img.youtube.com/vi/${video.id}/hqdefault.jpg`;
        if (video.url) {
            const m = String(video.url).match(/(?:v=|\/)([A-Za-z0-9_-]{11})/);
            if (m) return `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`;
        }
    } catch (_) {}
    return null;
}

async function fetchThumbRaw(video) {
    const url = thumbUrlFromVideo(video);
    if (!url) return null;
    try {
        const resp = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            maxContentLength: 8 * 1024 * 1024,
            maxBodyLength: 8 * 1024 * 1024,
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!resp.data) return null;
        const buf = Buffer.from(resp.data);
        if (buf.length < 100) return null;
        return buf;
    } catch (_) { return null; }
}

async function toCircularAvatar(buf, size) {
    try {
        const resized = await sharp(buf, { failOn: 'none' }).rotate().resize(size, size, { fit: 'cover' }).png().toBuffer();
        const mask = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`;
        return await sharp(resized).composite([{ input: Buffer.from(mask), blend: 'dest-in' }]).png().toBuffer();
    } catch (_) { return null; }
}

async function placeholderAvatar(size) {
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="hsl(260,68%,48%)"/><text x="${size / 2}" y="${size / 2 + Math.round(size * 0.14)}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(size * 0.5)}" font-weight="800" fill="white">♪</text></svg>`;
    try { return await sharp(Buffer.from(svg)).png().toBuffer(); } catch (_) { return null; }
}

async function generateMusicCover({ title, duration, source, channelName, botName, thumbRaw }) {
    const W = OUT_W;
    const H = OUT_H;
    const bg0 = '#0f0f14';
    const bg1 = '#1a1030';
    const accent = '#e1306c';
    const text = '#ffffff';
    const sub = '#c9c9d6';

    const AV = 190;
    const avX = 64;
    const avY = Math.round((H - AV) / 2);
    const txX = avX + AV + 40;

    const titleSafe = escapeXml(truncate(title || 'Música', 32));
    const metaSafe = escapeXml(truncate(`⏱ ${duration || '--:--'} • ▶ ${source || 'YouTube'}`, 48));
    const channelSafe = escapeXml(truncate(`📢 ${channelName || 'Canal Oficial'}`, 44));
    const botSafe = escapeXml(truncate(botName || 'Bot', 40));

    const baseSvg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="${bg0}"/>
                <stop offset="100%" stop-color="${bg1}"/>
            </linearGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#bg)"/>
    </svg>`;

    let buf = await sharp(Buffer.from(baseSvg)).png().toBuffer();

    // thumb como fundo esmaecido + véu escuro
    if (thumbRaw && Buffer.isBuffer(thumbRaw)) {
        try {
            const cover = await sharp(thumbRaw, { failOn: 'none' }).rotate().resize({ width: W, height: H, fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
            buf = await sharp(buf).composite([{ input: cover, opacity: 0.25 }]).png().toBuffer();
            const scrim = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="black" opacity="0.45"/></svg>`);
            buf = await sharp(buf).composite([{ input: scrim }]).png().toBuffer();
        } catch (_) {}
    }

    const textSvg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${W}" height="8" fill="${accent}"/>
        <circle cx="${avX + AV / 2}" cy="${avY + AV / 2}" r="${AV / 2 + 5}" fill="none" stroke="${accent}" stroke-width="5"/>
        <text x="${txX}" y="140" font-family="sans-serif" font-size="30" font-weight="800" fill="${sub}">🎵 TOCANDO AGORA</text>
        <text x="${txX}" y="200" font-family="sans-serif" font-size="40" font-weight="900" fill="${text}">${titleSafe}</text>
        <text x="${txX}" y="252" font-family="sans-serif" font-size="28" font-weight="700" fill="${text}">${metaSafe}</text>
        <text x="${txX}" y="302" font-family="sans-serif" font-size="24" fill="${sub}">${channelSafe}</text>
        <text x="${txX}" y="344" font-family="sans-serif" font-size="19" fill="${sub}">🤖 ${botSafe}</text>
        <rect x="${W - 260}" y="40" width="212" height="48" rx="24" fill="${accent}"/><text x="${W - 154}" y="72" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="800" fill="#fff">MÚSICA</text>
        <rect x="32" y="${H - 14}" width="${W - 64}" height="2" fill="${accent}" opacity="0.5"/>
    </svg>`;

    buf = await sharp(buf).composite([{ input: Buffer.from(textSvg) }]).png().toBuffer();

    try {
        let circ = null;
        if (thumbRaw && Buffer.isBuffer(thumbRaw)) circ = await toCircularAvatar(thumbRaw, AV);
        if (!circ) circ = await placeholderAvatar(AV);
        if (circ) buf = await sharp(buf).composite([{ input: circ, left: avX, top: avY }]).png().toBuffer();
    } catch (_) {}

    return await sharp(buf).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

module.exports = { generateMusicCover, fetchThumbRaw, OUT_W, OUT_H };
