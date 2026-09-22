const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const sharp = require('sharp');
const { resolveMenuImage } = require('./themes');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const OUT_W = 1080;
const OUT_H = Math.round(OUT_W * 9 / 21);

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

async function toCircularAvatar(buf, size) {
    try {
        const resized = await sharp(buf, { failOn: 'none' }).resize(size, size, { fit: 'cover' }).png().toBuffer();
        const circleSvg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`;
        return await sharp(resized).composite([{ input: Buffer.from(circleSvg), blend: 'dest-in' }]).png().toBuffer();
    } catch (_) { return null; }
}

async function placeholderAvatar(name, size) {
    const letter = String(name || '?').trim()[0]?.toUpperCase() || '?';
    let hash = 0;
    for (let i = 0; i < String(name).length; i++) hash = (hash * 31 + String(name).charCodeAt(i)) >>> 0;
    const hues = [260, 200, 160, 340, 30, 45, 280];
    const hue = hues[hash % hues.length];
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="hsl(${hue}, 68%, 48%)"/><text x="${size / 2}" y="${size / 2 + Math.round(size * 0.13)}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(size * 0.5)}" font-weight="800" fill="white">${escapeXml(letter)}</text></svg>`;
    try { return await sharp(Buffer.from(svg)).png().toBuffer(); } catch (_) { return null; }
}

/**
 * Gera card 21:9 do menu/ping estilo rank: foto do grupo + infos + cores do tema.
 * @param {Object} opts
 * @param {string} opts.title - nome do bot em destaque
 * @param {string} opts.headerEmoji
 * @param {string} opts.groupName
 * @param {string} opts.memberLabel - ex: "128 membros"
 * @param {string} opts.tagline
 * @param {string} opts.footer - nome do tema pequeno no rodapé (ex: "FORNALHA INFERNAL")
 * @param {string} opts.badge - ex: "HELL"
 * @param {Object} opts.theme - entrada do catálogo themes.js (usa .colors)
 * @param {Buffer} opts.avatarRaw - foto do grupo (opcional)
 * @param {boolean} opts.noCover - quando true, pula a foto de fundo + véu escuro
 *   (usado no card amarelo do modo parcial: fundo sólido claro + texto escuro).
 */
async function generateMenuImage({ title, headerEmoji, groupName, memberLabel, tagline, footer, badge, theme, avatarRaw, noCover }) {
    const W = OUT_W;
    const H = OUT_H;
    const C = (theme && theme.colors) ? theme.colors : {};
    const bg0 = C.bg0 || '#0f0f14';
    const bg1 = C.bg1 || '#141420';
    const accent = C.accent || '#6c5ce7';
    const text = C.text || '#ffffff';
    const sub = C.sub || '#a0a0b2';
    // Cor do texto do badge: branco sobre colorido escuro funciona, mas sobre
    // fundo claro (ex: amarelo do parcial) precisa de texto escuro.
    const badgeText = C.badgeText || '#fff';

    const AV = 180;
    const avX = 64;
    const avY = Math.round((H - AV) / 2);
    const txX = avX + AV + 40;

    const titleSafe = escapeXml(truncate(title || 'MENU', 30));
    const groupSafe = escapeXml(truncate(groupName || 'Grupo', 34));
    const memberSafe = escapeXml(memberLabel || '');
    const tagSafe = escapeXml(truncate(tagline || '', 48));
    const footerSafe = escapeXml(truncate(footer || '', 40));
    const badgeSafe = escapeXml(truncate(badge || '', 14));
    const emojiSafe = escapeXml(headerEmoji || '');

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

    // foto do grupo como fundo esmaecido (pulada no modo noCover: fundo sólido claro)
    if (!noCover && avatarRaw && Buffer.isBuffer(avatarRaw)) {
        try {
            const cover = await sharp(avatarRaw, { failOn: 'none' }).rotate().resize({ width: W, height: H, fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
            buf = await sharp(buf).composite([{ input: cover, opacity: 0.22 }]).png().toBuffer();
            const scrim = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="black" opacity="0.45"/></svg>`);
            buf = await sharp(buf).composite([{ input: scrim }]).png().toBuffer();
        } catch (_) {}
    }

    const textSvg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${W}" height="8" fill="${accent}"/>
        <circle cx="${avX + AV / 2}" cy="${avY + AV / 2}" r="${AV / 2 + 5}" fill="none" stroke="${accent}" stroke-width="5"/>
        <text x="${txX}" y="150" font-family="sans-serif" font-size="30" font-weight="800" fill="${sub}">${emojiSafe}</text>
        <text x="${txX}" y="205" font-family="sans-serif" font-size="52" font-weight="900" fill="${text}">${titleSafe}</text>
        <text x="${txX}" y="255" font-family="sans-serif" font-size="28" font-weight="700" fill="${text}">${groupSafe}${memberSafe ? ` • ${memberSafe}` : ''}</text>
        <text x="${txX}" y="305" font-family="sans-serif" font-size="21" fill="${sub}">${tagSafe}</text>
        ${footerSafe ? `<text x="${txX}" y="345" font-family="sans-serif" font-size="18" fill="${sub}">${footerSafe}</text>` : ''}
        ${badgeSafe ? `<rect x="${W - 260}" y="40" width="212" height="48" rx="24" fill="${accent}"/><text x="${W - 154}" y="72" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="800" fill="${badgeText}">${badgeSafe}</text>` : ''}
        <rect x="32" y="${H - 14}" width="${W - 64}" height="2" fill="${accent}" opacity="0.5"/>
    </svg>`;

    buf = await sharp(buf).composite([{ input: Buffer.from(textSvg) }]).png().toBuffer();

    // avatar circular do grupo por cima
    try {
        let circ = null;
        if (avatarRaw && Buffer.isBuffer(avatarRaw)) circ = await toCircularAvatar(avatarRaw, AV);
        if (!circ) circ = await placeholderAvatar(groupName, AV);
        if (circ) buf = await sharp(buf).composite([{ input: circ, left: avX, top: avY }]).png().toBuffer();
    } catch (_) {}

    return await sharp(buf).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}
function cachePathFor(jid) {
    const hash = crypto.createHash('md5').update(String(jid || '')).digest('hex');
    return path.join(process.cwd(), 'temp', `menu_group_${hash}.jpg`);
}

function isCacheFresh(p) {
    try {
        if (!fs.existsSync(p)) return false;
        const age = Date.now() - fs.statSync(p).mtimeMs;
        return age < CACHE_TTL_MS;
    } catch (_) { return false; }
}

async function getRawGroupBuffer(sock, jid) {
    try {
        const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
        if (!url) return null;
        const bustUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
        const resp = await axios.get(bustUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            maxContentLength: 5 * 1024 * 1024,
            headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache', 'User-Agent': 'Mozilla/5.0' }
        });
        if (!resp.data) return null;
        const buf = Buffer.from(resp.data);
        if (buf.length < 100) return null;
        return buf;
    } catch (_) { return null; }
}

async function cropTo21x9(buffer) {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    let pipeline = sharp(buffer, { failOn: 'none' }).rotate();
    if (w && h) {
        const target = 21 / 9;
        const current = w / h;
        let cropW, cropH, x, y;
        if (current > target) {
            cropH = h;
            cropW = Math.round(h * target);
            x = Math.round((w - cropW) / 2);
            y = 0;
        } else {
            cropW = w;
            cropH = Math.round(w / target);
            x = 0;
            y = Math.round((h - cropH) / 2);
        }
        if (cropW > 0 && cropH > 0) pipeline = pipeline.extract({ left: x, top: y, width: cropW, height: cropH });
    }
    return await pipeline
        .resize({ width: OUT_W, height: OUT_H, fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
}

async function getGroupMenuBuffer(sock, jid) {
    const cp = cachePathFor(jid);
    if (isCacheFresh(cp)) {
        try { return fs.readFileSync(cp); } catch (_) {}
    }
    const raw = await getRawGroupBuffer(sock, jid);
    if (!raw) return null;
    try {
        const out = await cropTo21x9(raw);
        try {
            const dir = path.dirname(cp);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(cp, out);
        } catch (_) {}
        return out;
    } catch (_) { return null; }
}

// Ordem de prioridade:
// 1. Imagem custom do grupo (!imagem) — crop 21:9
// 2. Foto do grupo cortada 21:9 (padrão novo)
// 3. Imagem do tema / aleatória / logo (fallback antigo)
async function resolveMenuImageBuffer(sock, { groupJid, groupMenuImage, themeId }) {
    if (groupMenuImage) {
        try {
            const p = path.isAbsolute(groupMenuImage) ? groupMenuImage : path.join(process.cwd(), groupMenuImage);
            if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p);
                return await cropTo21x9(raw);
            }
        } catch (_) {}
    }
    if (groupJid && groupJid.endsWith('@g.us') && sock) {
        const grp = await getGroupMenuBuffer(sock, groupJid);
        if (grp) return grp;
    }
    try {
        const fallbackPath = resolveMenuImage({ groupMenuImage: null, themeId });
        if (fallbackPath && fs.existsSync(fallbackPath)) {
            const raw = fs.readFileSync(fallbackPath);
            return await cropTo21x9(raw);
        }
    } catch (_) {}
    return null;
}

module.exports = {
    cropTo21x9,
    getGroupMenuBuffer,
    getRawGroupBuffer,
    resolveMenuImageBuffer,
    generateMenuImage,
    OUT_W,
    OUT_H
};
