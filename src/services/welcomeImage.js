const axios = require('axios');
const sharp = require('sharp');

// Card 21:9 — mesma escala do !menu (1080x463)
const W = 1080;
const H = 463;
const AV = 220;

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

// Quebra texto em linhas de no máx. maxChars sem cortar palavras.
function wrapLines(s, maxChars, maxLines) {
    const words = String(s || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
        const next = cur ? cur + ' ' + w : w;
        if (next.length <= maxChars) {
            cur = next;
        } else {
            if (cur) lines.push(cur);
            cur = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w;
            if (lines.length >= maxLines) break;
        }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines.slice(0, maxLines);
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

function isImageBuffer(buf) {
    if (!buf || buf.length < 100) return false;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true;
    return false;
}

async function fetchImageBuffer(url) {
    if (!url) return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            maxContentLength: 5 * 1024 * 1024,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        }).catch(() => null);
        if (!res || !res.data) return null;
        const buf = Buffer.from(res.data);
        return isImageBuffer(buf) ? buf : null;
    } catch (_) { return null; }
}

// resolve @lid -> @s.whatsapp.net via metadados (profilePictureUrl costuma falhar com lid puro)
function resolvePhoneJid(target, participants) {
    if (!target || !Array.isArray(participants)) return null;
    const norm = String(target).split('@')[0].split(':')[0];
    for (const p of participants) {
        const cands = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean);
        for (const c of cands) {
            if (String(c).split('@')[0].split(':')[0] === norm) {
                if (p.id && p.id.endsWith('@s.whatsapp.net')) return p.id;
                if (p.jid && p.jid.endsWith('@s.whatsapp.net')) return p.jid;
                if (p.phoneNumber && String(p.phoneNumber).includes('@')) return String(p.phoneNumber);
            }
        }
    }
    return null;
}

/**
 * Baixa a foto de perfil de um usuário (com fallback @lid -> número).
 * @returns {Promise<Buffer|null>}
 */
async function getUserAvatarBuffer(sock, userJid, groupJid, groupMetadataCached) {
    try {
        let participants = [];
        try {
            if (groupJid && typeof groupMetadataCached === 'function') {
                const meta = await groupMetadataCached(sock, groupJid).catch(() => null);
                if (Array.isArray(meta?.participants)) participants = meta.participants;
            }
        } catch (_) {}
        const tries = [userJid];
        const phone = resolvePhoneJid(userJid, participants);
        if (phone && phone !== userJid) tries.push(phone);
        for (const t of tries) {
            try {
                const url = await sock.profilePictureUrl(t, 'image').catch(() => null);
                if (!url) continue;
                const buf = await fetchImageBuffer(url);
                if (buf) return buf;
            } catch (_) { continue; }
        }
    } catch (_) {}
    return null;
}

/**
 * Gera card 21:9 de boas-vindas/despedida/promoção (mesma escala do !menu)
 * com a foto da pessoa e a FOTO DO GRUPO como fundo.
 * @param {Object} opts
 * @param {'welcome'|'goodbye'|'promote'|'demote'|'groupchange'} opts.mode
 * @param {string} opts.userName - nome ou @número exibido
 * @param {string} opts.groupName
 * @param {number} opts.memberCount
 * @param {string} opts.message - mensagem custom (vai na legenda; no card vai resumida)
 * @param {Buffer} opts.avatarRaw - foto de perfil da pessoa (opcional, usa placeholder com inicial)
 * @param {Buffer} opts.groupAvatarRaw - foto do grupo p/ fundo (igual !menu). Se ausente, usa avatarRaw como fundo.
 * @param {Object} opts.theme - entrada do catálogo themes.js (usa .colors)
 */
async function generateWelcomeImage({ mode, userName, groupName, memberCount, message, avatarRaw, groupAvatarRaw, theme }) {
    const C = (theme && theme.colors) ? theme.colors : {};
    const bg0 = C.bg0 || '#060f24';
    const bg1 = C.bg1 || '#0a1c44';
    const accent = C.accent || '#2563eb';
    const text = C.text || '#ffffff';
    const sub = C.sub || '#93c5fd';

    const isBye = mode === 'goodbye';
    const isPromote = mode === 'promote';
    const isDemote = mode === 'demote';
    const isGroupChange = mode === 'groupchange';
    const title = isBye ? 'ATÉ LOGO 👋'
        : isPromote ? 'PROMOVIDO 👑'
        : isDemote ? 'REBAIXADO 📉'
        : isGroupChange ? 'GRUPO ATUALIZADO ⚙️'
        : 'BEM-VINDO 👋';

    const nameSafe = escapeXml(truncate(userName || 'Novo membro', 22));
    const groupSafe = escapeXml(truncate(groupName || 'o grupo', 30));
    const countSafe = memberCount ? escapeXml(`• ${memberCount} membros`) : '';
    const msgLines = wrapLines(message || '', 44, 2).map(escapeXml);

    // Layout 21:9 estilo menu: avatar à esquerda, textos à direita
    const avX = 56;
    const avY = Math.round((H - AV) / 2);
    const txX = avX + AV + 36;

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

    // Fundo: foto do grupo esmaecida (igual ao !menu). Fallback: foto da pessoa.
    const bgRaw = (groupAvatarRaw && Buffer.isBuffer(groupAvatarRaw)) ? groupAvatarRaw
        : (avatarRaw && Buffer.isBuffer(avatarRaw) ? avatarRaw : null);
    if (bgRaw) {
        try {
            const cover = await sharp(bgRaw, { failOn: 'none' }).rotate().resize({ width: W, height: H, fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
            buf = await sharp(buf).composite([{ input: cover, opacity: 0.30 }]).png().toBuffer();
            const scrim = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="black" opacity="0.5"/></svg>`);
            buf = await sharp(buf).composite([{ input: scrim }]).png().toBuffer();
        } catch (_) {}
    }

    const cy = avY + AV / 2;
    let textSvg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${W}" height="8" fill="${accent}"/>
        <circle cx="${avX + AV / 2}" cy="${cy}" r="${AV / 2 + 6}" fill="none" stroke="${accent}" stroke-width="5"/>
        <text x="${txX}" y="150" font-family="sans-serif" font-size="36" font-weight="900" fill="${text}">${escapeXml(title)}</text>
        <text x="${txX}" y="214" font-family="sans-serif" font-size="46" font-weight="900" fill="${text}">${nameSafe}</text>
        <text x="${txX}" y="258" font-family="sans-serif" font-size="24" font-weight="700" fill="${sub}">${groupSafe}${countSafe ? ` ${countSafe}` : ''}</text>`;
    let lineY = 302;
    for (const ln of msgLines) {
        textSvg += `<text x="${txX}" y="${lineY}" font-family="sans-serif" font-size="21" fill="${text}">${ln}</text>`;
        lineY += 36;
    }
    textSvg += `
        <rect x="${txX}" y="${H - 24}" width="${W - txX - 56}" height="3" fill="${accent}" opacity="0.6"/>
    </svg>`;

    buf = await sharp(buf).composite([{ input: Buffer.from(textSvg) }]).png().toBuffer();

    // avatar circular por cima
    try {
        let circ = null;
        if (avatarRaw && Buffer.isBuffer(avatarRaw)) circ = await toCircularAvatar(avatarRaw, AV);
        if (!circ) circ = await placeholderAvatar(userName, AV);
        if (circ) buf = await sharp(buf).composite([{ input: circ, left: avX, top: avY }]).png().toBuffer();
    } catch (_) {}

    return await sharp(buf).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

module.exports = {
    generateWelcomeImage,
    getUserAvatarBuffer,
    getGroupAvatarBuffer,
    fetchImageBuffer,
    W,
    H
};

/**
 * Baixa a foto do grupo (para usar como fundo do card, igual !menu).
 * @returns {Promise<Buffer|null>}
 */
async function getGroupAvatarBuffer(sock, groupJid) {
    try {
        const url = await sock.profilePictureUrl(groupJid, 'image').catch(() => null);
        if (!url) return null;
        return await fetchImageBuffer(url);
    } catch (_) { return null; }
}
