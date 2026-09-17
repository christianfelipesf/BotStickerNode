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
    const clean = String(name || '').replace(/^@+/, '').trim();
    const alnum = clean.match(/[\p{L}\p{N}]/u);
    const letter = (alnum ? alnum[0] : '?').toUpperCase();
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
// Compara a parte numérica (sem sufixo de aparelho ":xx") em todos os campos conhecidos.
function _userPart(jid) {
    return String(jid || '').split('@')[0].split(':')[0];
}
function resolvePhoneJid(target, participants) {
    if (!target || !Array.isArray(participants)) return null;
    const norm = _userPart(target);
    if (!norm) return null;
    for (const p of participants) {
        if (!p || typeof p !== 'object') continue;
        const cands = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean);
        for (const c of cands) {
            const cu = String(c).includes('@') ? _userPart(c) : String(c).replace(/\D/g, '');
            if (cu === norm || String(c).replace(/\D/g, '') === norm.replace(/\D/g, '')) {
                if (p.id && p.id.endsWith('@s.whatsapp.net')) return p.id;
                if (p.jid && p.jid.endsWith('@s.whatsapp.net')) return p.jid;
                if (p.phoneNumber && String(p.phoneNumber).includes('@')) return String(p.phoneNumber);
                // phoneNumber às vezes vem como dígitos puros
                const digits = String(p.phoneNumber || '').replace(/\D/g, '');
                if (/^\d{8,15}$/.test(digits)) return `${digits}@s.whatsapp.net`;
            }
        }
    }
    return null;
}

/**
 * JID "exibível" da pessoa: telefone quando dá para resolver o @lid,
 * senão o JID original. Nunca retorna null.
 */
function resolveDisplayJid(target, participants) {
    try { return resolvePhoneJid(target, participants) || target; } catch (_) { return target; }
}

/**
 * Formata telefone BR para exibição: 5515998989898 → (15) 99898-9898.
 * Fora do padrão BR, devolve +<dígitos>. Nunca retorna null.
 */
function formatPhoneDisplay(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    let core = d;
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) core = d.slice(2);
    if (/^\d{10}$/.test(core)) return `(${core.slice(0, 2)}) ${core.slice(2, 6)}-${core.slice(6)}`;
    if (/^\d{11}$/.test(core)) return `(${core.slice(0, 2)}) ${core.slice(2, 7)}-${core.slice(7)}`;
    return `+${d}`;
}

/**
 * Nome exibível da pessoa: telefone formatado quando resolvível,
 * senão rótulo genérico. Evita vazar o número opaco do @lid no card.
 */
function displayNameForEvent(target, participants) {
    const jid = resolveDisplayJid(target, participants);
    const digits = _userPart(jid);
    if (/^\d{8,15}$/.test(digits)) {
        // @lid não resolvido = ID opaco (não é telefone): não exibe o número.
        if (String(target).endsWith('@lid') && jid === target) return 'Novo membro';
        return formatPhoneDisplay(digits);
    }
    return 'Novo membro';
}

/**
 * Baixa a foto de perfil de um usuário (com fallback @lid -> número).
 * @param {Array} [participantsHint] - participants já buscados (evita refetch e race no evento add)
 * @returns {Promise<Buffer|null>}
 */
async function getUserAvatarBuffer(sock, userJid, groupJid, groupMetadataCached, participantsHint) {
    try {
        let participants = Array.isArray(participantsHint) ? participantsHint : [];
        if (!participants.length) {
            try {
                if (groupJid && typeof groupMetadataCached === 'function') {
                    const meta = await groupMetadataCached(sock, groupJid).catch(() => null);
                    if (Array.isArray(meta?.participants)) participants = meta.participants;
                }
            } catch (_) {}
        }
        const phone = resolvePhoneJid(userJid, participants);
        // Tenta o JID original, o telefone resolvido e as variantes de domínio —
        // o endpoint do WhatsApp aceita um formato mas rejeita outro conforme o caso.
        const seen = new Set();
        const tries = [];
        for (const j of [userJid, phone]) {
            if (!j || seen.has(j)) continue;
            seen.add(j);
            tries.push(j);
            const user = _userPart(j);
            for (const dom of ['@s.whatsapp.net', '@lid']) {
                const v = user + dom;
                if (!seen.has(v)) { seen.add(v); tries.push(v); }
            }
        }
        for (const t of tries) {
            for (const type of ['image', 'preview']) {
                try {
                    const url = await sock.profilePictureUrl(t, type).catch(() => null);
                    if (!url) continue;
                    const buf = await fetchImageBuffer(url);
                    if (buf) return buf;
                } catch (_) { continue; }
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Gera card 21:9 de boas-vindas/despedida/promoção (mesma escala do !menu)
 * com a foto da pessoa e a FOTO DO GRUPO como fundo.
 * Promoção/rebaixamento: mostra TAMBÉM quem fez a ação (autor em cima,
 * alvo embaixo) e usa cor do modo (verde = promoveu, vermelho = rebaixou).
 * @param {Object} opts
 * @param {'welcome'|'goodbye'|'promote'|'demote'|'groupchange'} opts.mode
 * @param {string} opts.userName - nome ou @número exibido (quem recebeu a ação)
 * @param {string} opts.actorName - nome ou @número de quem FEZ a ação (só promote/demote)
 * @param {string} opts.groupName
 * @param {number} opts.memberCount
 * @param {string} opts.message - mensagem custom (vai na legenda; no card vai resumida)
 * @param {Buffer} opts.avatarRaw - foto de perfil da pessoa (opcional, usa placeholder com inicial)
 * @param {Buffer} opts.actorAvatarRaw - foto de quem fez a ação (só promote/demote)
 * @param {Buffer} opts.groupAvatarRaw - foto do grupo p/ fundo (igual !menu). Se ausente, usa avatarRaw como fundo.
 * @param {Object} opts.theme - entrada do catálogo themes.js (usa .colors)
 */
async function generateWelcomeImage({ mode, userName, actorName, groupName, memberCount, message, avatarRaw, actorAvatarRaw, groupAvatarRaw, theme }) {
    const C = (theme && theme.colors) ? theme.colors : {};
    const bg0 = C.bg0 || '#060f24';
    const bg1 = C.bg1 || '#0a1c44';
    const text = C.text || '#ffffff';
    const sub = C.sub || '#93c5fd';

    const isBye = mode === 'goodbye';
    const isPromote = mode === 'promote';
    const isDemote = mode === 'demote';
    const isGroupChange = mode === 'groupchange';
    // Cor do modo: verde promoveu, vermelho rebaixou (pede do dono; vale sobre o tema).
    const MODE_COLOR = isPromote ? '#22c55e' : isDemote ? '#ef4444' : null;
    const accent = MODE_COLOR || C.accent || '#2563eb';

    const hasActor = (isPromote || isDemote) && !!(actorName || actorAvatarRaw);
    const title = isBye ? 'ATÉ LOGO 👋'
        : isPromote ? 'PROMOVIDO 👑'
        : isDemote ? 'REBAIXADO 📉'
        : isGroupChange ? 'GRUPO ATUALIZADO ⚙️'
        : 'BEM-VINDO 👋';

    const nameSafe = escapeXml(truncate(userName || 'Novo membro', 22));
    const actorSafe = escapeXml(truncate(actorName || '', 22));
    const groupSafe = escapeXml(truncate(groupName || 'o grupo', 30));
    const countSafe = memberCount ? escapeXml(`• ${memberCount} membros`) : '';
    const msgLines = wrapLines(message || '', 44, 2).map(escapeXml);

    // Layout 21:9 estilo menu: avatar à esquerda, textos à direita.
    // Promoção/rebaixamento com autor: 2 avatares empilhados (autor em cima,
    // alvo embaixo) e textos deslocados.
    const AV2 = 150;
    const avSize = hasActor ? AV2 : AV;
    const colCX = 56 + AV / 2; // centro da coluna de avatares (igual nos 2 modos)
    const avX = Math.round(colCX - avSize / 2);
    const avY = hasActor ? 36 : Math.round((H - AV) / 2);
    const avY2 = avY + avSize + 20;
    const txX = avX + avSize + 36;

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

    const cy = avY + avSize / 2;
    const cy2 = hasActor ? avY2 + avSize / 2 : 0;
    let textSvg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${W}" height="8" fill="${accent}"/>
        <circle cx="${colCX}" cy="${cy}" r="${avSize / 2 + 6}" fill="none" stroke="${accent}" stroke-width="5"/>`;
    if (hasActor) {
        textSvg += `<circle cx="${colCX}" cy="${cy2}" r="${avSize / 2 + 6}" fill="none" stroke="${accent}" stroke-width="5"/>`;
    }
    if (hasActor) {
        // Alvo em destaque + quem fez a ação logo abaixo.
        textSvg += `
        <text x="${txX}" y="120" font-family="sans-serif" font-size="34" font-weight="900" fill="${text}">${escapeXml(title)}</text>
        <text x="${txX}" y="180" font-family="sans-serif" font-size="44" font-weight="900" fill="${text}">${nameSafe}</text>
        <text x="${txX}" y="222" font-family="sans-serif" font-size="23" font-weight="700" fill="${sub}">por ${actorSafe}</text>
        <text x="${txX}" y="262" font-family="sans-serif" font-size="23" font-weight="700" fill="${sub}">${groupSafe}${countSafe ? ` ${countSafe}` : ''}</text>`;
    } else {
        textSvg += `
        <text x="${txX}" y="150" font-family="sans-serif" font-size="36" font-weight="900" fill="${text}">${escapeXml(title)}</text>
        <text x="${txX}" y="214" font-family="sans-serif" font-size="46" font-weight="900" fill="${text}">${nameSafe}</text>
        <text x="${txX}" y="258" font-family="sans-serif" font-size="24" font-weight="700" fill="${sub}">${groupSafe}${countSafe ? ` ${countSafe}` : ''}</text>`;
    }
    let lineY = hasActor ? 306 : 302;
    for (const ln of msgLines) {
        textSvg += `<text x="${txX}" y="${lineY}" font-family="sans-serif" font-size="21" fill="${text}">${ln}</text>`;
        lineY += 36;
    }
    textSvg += `
        <rect x="${txX}" y="${H - 24}" width="${W - txX - 56}" height="3" fill="${accent}" opacity="0.6"/>
    </svg>`;

    buf = await sharp(buf).composite([{ input: Buffer.from(textSvg) }]).png().toBuffer();

    // avatar(es) circular(es) por cima: autor em cima, alvo embaixo (promote/demote)
    try {
        let circ = null;
        if (avatarRaw && Buffer.isBuffer(avatarRaw)) circ = await toCircularAvatar(avatarRaw, avSize);
        if (!circ) circ = await placeholderAvatar(userName, avSize);
        if (circ) {
            const top = hasActor ? avY2 : avY;
            buf = await sharp(buf).composite([{ input: circ, left: avX, top }]).png().toBuffer();
        }
        if (hasActor) {
            let circActor = null;
            if (actorAvatarRaw && Buffer.isBuffer(actorAvatarRaw)) circActor = await toCircularAvatar(actorAvatarRaw, avSize);
            if (!circActor) circActor = await placeholderAvatar(actorName, avSize);
            if (circActor) buf = await sharp(buf).composite([{ input: circActor, left: avX, top: avY }]).png().toBuffer();
        }
    } catch (_) {}

    return await sharp(buf).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

module.exports = {
    generateWelcomeImage,
    getUserAvatarBuffer,
    getGroupAvatarBuffer,
    fetchImageBuffer,
    formatPhoneDisplay,
    resolvePhoneJid,
    resolveDisplayJid,
    displayNameForEvent,
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
