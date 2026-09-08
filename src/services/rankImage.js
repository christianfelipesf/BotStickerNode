const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

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

const MEDALS = ['🥇', '🥈', '🥉'];
const COLORS = {
    bg: '#0f0f14',
    headerBg: '#1a1a24',
    gold: '#FFD700',
    silver: '#C0C0C0',
    bronze: '#CD7F32',
    rowAlt: '#17171f',
    row: '#1e1e2a',
    text: '#ffffff',
    sub: '#a0a0b2',
    accent: '#6c5ce7'
};

const AVATAR_SIZE = 56;

// Gera buffer circular a partir de imagem quadrada
async function toCircularAvatar(buf, size = AVATAR_SIZE) {
    try {
        const resized = await sharp(buf, { failOn: 'none' }).resize(size, size, { fit: 'cover' }).png().toBuffer();
        const circleSvg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`;
        const rounded = await sharp(resized).composite([{ input: Buffer.from(circleSvg), blend: 'dest-in' }]).png().toBuffer();
        return rounded;
    } catch (_) { return null; }
}

async function placeholderAvatar(name, size = AVATAR_SIZE) {
    const letter = String(name || '?').trim()[0]?.toUpperCase() || '?';
    // cor determinística pelo nome
    let hash = 0; for (let i=0;i<String(name).length;i++) hash = (hash*31 + String(name).charCodeAt(i)) >>> 0;
    const hues = [260, 200, 160, 340, 30, 45, 280];
    const hue = hues[hash % hues.length];
    const bg = `hsl(${hue}, 68%, 48%)`;
    const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="${bg}"/><text x="${size/2}" y="${size/2+7}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(size*0.5)}" font-weight="800" fill="white">${escapeXml(letter)}</text></svg>`;
    try { return await sharp(Buffer.from(svg)).png().toBuffer(); } catch (_) { return null; }
}

/**
 * Gera imagem do rank mensal (top 10).
 * @param {Object} opts
 * @param {string} opts.groupName
 * @param {string} opts.botName
 * @param {string} opts.monthLabel - ex: "setembro de 2026"
 * @param {Array<{name:string,count:number, avatar?:Buffer, avatarUrl?:string}>} opts.ranking - já ordenado desc
 * @param {string} opts.monthKey - "2026-09" para debug
 * @param {Array<Buffer>} opts._avatarBuffers - interno: já circulares (opcional)
 */
async function generateRankImage({ groupName, botName, monthLabel, ranking, monthKey }) {
    const top = Array.isArray(ranking) ? ranking.slice(0, 10) : [];
    const W = 1080;
    const HEADER_H = 210;
    const ROW_H = 72;
    const PAD = 32;
    const FOOTER_H = 70;
    const H = HEADER_H + Math.max(top.length, 1) * ROW_H + FOOTER_H + PAD;

    // Guarda avatares crus para gerar depois do scale (precisa do scale do density)
    const rawAvatars = top.map(u => (u.avatar && Buffer.isBuffer(u.avatar) ? u.avatar : null));
    const avatarNames = top.map(u => u.name);

    const rowsSvg = top.length === 0
        ? `<text x="${W/2}" y="${HEADER_H + 80}" text-anchor="middle" font-family="sans-serif" font-size="28" fill="${COLORS.sub}">Nenhum registro este mês. Seja o primeiro a falar! 💬</text>`
        : top.map((u, i) => {
            const y = HEADER_H + i * ROW_H;
            const isTop3 = i < 3;
            const bg = i % 2 === 0 ? COLORS.row : COLORS.rowAlt;
            const borderColor = i === 0 ? COLORS.gold : i === 1 ? COLORS.silver : i === 2 ? COLORS.bronze : 'transparent';
            const medal = i < 3 ? MEDALS[i] : `#${i + 1}`;
            const name = escapeXml(truncate(u.name, 24));
            const count = Number(u.count) || 0;
            const countLabel = count === 1 ? '1 msg' : `${count} msgs`;
            // barra proporcional ao top 1
            const max = top[0]?.count || 1;
            const barW = Math.max(40, Math.round((count / max) * 220));

            // posição: medal | avatar | nome | count
            const medalX = 36;
            const avatarX = 84; // avatar 56px, deixa medal + gap
            const nameX = 160;
            const countX = W - 180;
            const avatarBorder = isTop3 ? borderColor : '#2a2a3a';

            return `
            <g>
                <rect x="${PAD}" y="${y}" width="${W - PAD*2}" height="${ROW_H - 8}" rx="14" fill="${bg}" stroke="${borderColor}" stroke-width="${isTop3 ? 2 : 0}"/>
                <!-- medal -->
                <text x="${medalX}" y="${y + 44}" font-family="sans-serif" font-size="${i < 3 ? 34 : 24}" font-weight="700" fill="${isTop3 ? borderColor : COLORS.sub}">${escapeXml(medal)}</text>
                <!-- avatar placeholder border (imagem real vem via composite) -->
                <circle cx="${avatarX + AVATAR_SIZE/2}" cy="${y + (ROW_H-8)/2}" r="${AVATAR_SIZE/2 + 2}" fill="none" stroke="${avatarBorder}" stroke-width="2"/>
                <!-- nome -->
                <text x="${nameX}" y="${y + 32}" font-family="sans-serif" font-size="26" font-weight="700" fill="${COLORS.text}">${name}</text>
                <text x="${nameX}" y="${y + 54}" font-family="sans-serif" font-size="16" fill="${COLORS.sub}">${isTop3 ? '★ TOP '+ (i+1) : 'ativo do mês'}</text>
                <!-- count -->
                <text x="${countX}" y="${y + 40}" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="800" fill="${COLORS.text}">${escapeXml(countLabel)}</text>
                <!-- barra -->
                <rect x="${countX - 110}" y="${y + 48}" width="${barW}" height="6" rx="3" fill="${isTop3 ? borderColor : COLORS.accent}" opacity="0.95"/>
            </g>`;
        }).join('\n');

    const headerSvg = `
        <rect x="0" y="0" width="${W}" height="${HEADER_H}" rx="0" fill="${COLORS.headerBg}"/>
        <rect x="0" y="0" width="${W}" height="6" fill="${COLORS.accent}"/>
        <!-- ícone troféu -->
        <text x="${PAD}" y="85" font-family="sans-serif" font-size="56">🏆</text>
        <text x="110" y="70" font-family="sans-serif" font-size="38" font-weight="900" fill="${COLORS.text}">RANK MENSAL — TOP 10 ATIVOS</text>
        <text x="110" y="105" font-family="sans-serif" font-size="22" font-weight="600" fill="${COLORS.sub}">${escapeXml(truncate(groupName || 'Grupo', 42))} • ${escapeXml(monthLabel || '')}</text>
        <text x="110" y="135" font-family="sans-serif" font-size="16" fill="${COLORS.sub}">${escapeXml(botName || 'Bot')} • reseta todo dia 1 • ${escapeXml(monthKey || '')}</text>
        <!-- badge mês -->
        <rect x="${W - 240}" y="32" width="208" height="42" rx="21" fill="${COLORS.accent}"/>
        <text x="${W - 136}" y="60" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="800" fill="#fff">${escapeXml((monthLabel || '').toUpperCase().slice(0,22))}</text>
        <!-- linha divisória -->
        <rect x="${PAD}" y="${HEADER_H - 12}" width="${W - PAD*2}" height="1" fill="#2a2a3a"/>
    `;

    const footerSvg = `
        <text x="${W/2}" y="${H - 28}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="${COLORS.sub}">Use !rank ou !rankativos para ver este ranking • ${escapeXml(botName || '')}</text>
    `;

    const svg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#0f0f14"/>
                <stop offset="100%" stop-color="#141420"/>
            </linearGradient>
        </defs>
        <rect width="${W}" height="${H}" rx="24" fill="url(#bg)"/>
        ${headerSvg}
        ${rowsSvg}
        ${footerSvg}
    </svg>`;

    // Render via sharp - density 220 aumenta nitidez, mas escala o buffer
    let buf = await sharp(Buffer.from(svg), { density: 220 }).png().toBuffer();
    let scale = 1;
    try {
        const meta = await sharp(buf).metadata();
        if (meta.width && W) scale = meta.width / W;
    } catch (_) {}
    if (!scale || !isFinite(scale) || scale <= 0) scale = 220 / 72;

    // Compõe avatares circulares - precisa escalar coordenadas e tamanho para bater com o buffer density
    if (top.length > 0) {
        try {
            const avatarSizeScaled = Math.max(1, Math.round(AVATAR_SIZE * scale));
            const composites = [];
            for (let i = 0; i < top.length; i++) {
                const raw = rawAvatars[i];
                const name = avatarNames[i];
                let circ = null;
                if (raw) circ = await toCircularAvatar(raw, avatarSizeScaled);
                if (!circ) circ = await placeholderAvatar(name, avatarSizeScaled);
                if (!circ) continue;
                const y = HEADER_H + i * ROW_H;
                const avatarX = 84;
                const avatarY = y + Math.round(((ROW_H - 8) - AVATAR_SIZE) / 2);
                const left = Math.round(avatarX * scale);
                const topPos = Math.round(avatarY * scale);
                composites.push({ input: circ, left, top: topPos });
            }
            if (composites.length) buf = await sharp(buf).composite(composites).png().toBuffer();
        } catch (e) {
            console.warn('⚠️ [rankImage] falha composite avatares:', e.message);
        }
    }

    return buf;
}

module.exports = { generateRankImage };
