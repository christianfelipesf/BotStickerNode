// splash.js — curiosidade cômica automática a cada N mensagens por grupo.
// Estilo "tela de loading": texto curto + card com imagem (reusa menuImage).
// Contador em memória (Map por jid), rotação sem repetir em sequência.
const CURIOSIDADES = require('../data/curiosidades');

let sockRef = null;

// jid -> { count, idx, lastSentAt }
const counters = new Map();
const MAX_GROUPS = 1000;

function attachSock(sock) { sockRef = sock; }

function _cfg() {
    try {
        const { readConfig } = require('../database/utils');
        return readConfig();
    } catch (_) { return {}; }
}

function getInterval() {
    const cfg = _cfg();
    const n = Number(cfg.splashInterval) || 40;
    return Math.max(10, Math.min(200, n));
}

function isEnabled() {
    const cfg = _cfg();
    return cfg.splashEnabled !== false;
}

function withImage() {
    const cfg = _cfg();
    return cfg.splashWithImage !== false;
}

function getCooldownMs() {
    const cfg = _cfg();
    const n = Number(cfg.splashCooldownMs);
    if (Number.isFinite(n) && n >= 0) return Math.min(3600000, n);
    return 90000;
}

function _entry(jid) {
    let e = counters.get(jid);
    if (!e) {
        // Offset inicial por hash do jid: grupos diferentes começam
        // em curiosidades diferentes em vez de todos na #0.
        let hash = 0;
        const s = String(jid || '');
        for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
        e = { count: 0, idx: CURIOSIDADES.length ? hash % CURIOSIDADES.length : 0, lastSentAt: 0 };
        if (counters.size >= MAX_GROUPS && !counters.has(jid)) {
            const oldest = counters.keys().next().value;
            counters.delete(oldest);
        }
        counters.set(jid, e);
    }
    return e;
}

function pickNext(jid) {
    const e = _entry(jid);
    if (!CURIOSIDADES.length) return '';
    const texto = CURIOSIDADES[e.idx % CURIOSIDADES.length];
    e.idx = (e.idx + 1) % CURIOSIDADES.length;
    return texto;
}

function pickRandom() {
    if (!CURIOSIDADES.length) return '';
    return CURIOSIDADES[Math.floor(Math.random() * CURIOSIDADES.length)];
}

function getCount(jid) {
    const e = counters.get(jid);
    return e ? e.count : 0;
}

function reset(jid) {
    if (jid) counters.delete(jid);
    else counters.clear();
}

function buildCaption(curiosidade, prefix, botName) {
    const p = prefix || '!';
    const lines = [
        '💡 *VOCÊ SABIA?*',
        '',
        `_${curiosidade}_`,
        '',
        `📖 Digite *${p}menu* para ver os comandos do *${botName || 'bot'}*`
    ];
    return lines.join('\n');
}

async function sendSplash(sock, jid, { curiosidade, prefix, quoted } = {}) {
    const s = sock || sockRef;
    if (!s || !jid) return false;
    const cfg = _cfg();
    const text = curiosidade || pickNext(jid);
    if (!text) return false;
    const caption = buildCaption(text, prefix || cfg.prefix, cfg.botName);

    if (withImage()) {
        try {
            const { generateMenuImage, getRawGroupBuffer } = require('./menuImage');
            const { getTheme } = require('./themes');
            const utils = require('../database/utils');
            let groupName = 'Grupo';
            let memberLabel = '';
            let avatarRaw = null;
            let theme = null;
            try {
                const meta = await utils.groupMetadataCached(s, jid).catch(() => null);
                if (meta?.subject) groupName = meta.subject;
                const n = Array.isArray(meta?.participants) ? meta.participants.length : 0;
                if (n > 0) memberLabel = `${n} membros`;
            } catch (_) {}
            try { avatarRaw = await getRawGroupBuffer(s, jid).catch(() => null); } catch (_) { avatarRaw = null; }
            try {
                const themeId = typeof utils.getThemeForJid === 'function' ? utils.getThemeForJid(jid) : 'default';
                theme = getTheme(themeId);
            } catch (_) { theme = null; }
            const card = await generateMenuImage({
                title: 'VOCÊ SABIA?',
                headerEmoji: '💡',
                groupName,
                memberLabel,
                tagline: String(text).slice(0, 90),
                footer: 'SPLASH DO BOT',
                badge: 'DICA',
                theme,
                avatarRaw
            });
            if (card) {
                await s.sendMessage(jid, { image: card, caption }, quoted ? { quoted } : {});
                return true;
            }
        } catch (_) {
            // cai para texto abaixo
        }
    }
    await s.sendMessage(jid, { text: caption }, quoted ? { quoted } : {});
    return true;
}

// Chamado a cada mensagem normal de grupo (não-comando, não-bot).
// Retorna true se disparou o splash.
async function handleMessage(sock, jid, { prefix } = {}) {
    if (!jid || !String(jid).endsWith('@g.us')) return false;
    if (!isEnabled()) return false;
    const e = _entry(jid);
    e.count += 1;
    const interval = getInterval();
    if (e.count < interval) return false;
    // Cooldown anti-flood: grupo hiper-ativo não recebe 2 cards em segundos.
    const now = Date.now();
    if (now - (e.lastSentAt || 0) < getCooldownMs()) {
        e.count = interval; // segura no teto até o cooldown passar
        return false;
    }
    e.count = 0;
    e.lastSentAt = now;
    try {
        const cfg = _cfg();
        const ok = await sendSplash(sock || sockRef, jid, { prefix: prefix || cfg.prefix });
        try {
            const utils = require('../database/utils');
            if (utils.safeDashboardLog) { /* logado pelo chamador se quiser */ }
        } catch (_) {}
        return ok;
    } catch (err) {
        console.error('⚠️ [splash] falha ao enviar:', err?.message || err);
        return false;
    }
}

module.exports = {
    attachSock,
    handleMessage,
    sendSplash,
    pickNext,
    pickRandom,
    buildCaption,
    getCount,
    reset,
    isEnabled,
    getInterval,
    _counters: counters
};
