// splash.js — curiosidade cômica automática por grupo (anti-spam).
// Regra: no máximo 1 a cada 6 horas E no mínimo 60 mensagens desde o último envio.
// Depois que aparece dentro da janela de 6h, não aparece mais até vencer o prazo,
// mesmo que o grupo passe das 60 mensagens.
// Estilo "tela de loading": texto curto + card com imagem (reusa menuImage).
// Contador em memória (Map por jid), rotação sem repetir em sequência.
const CURIOSIDADES = require('../data/curiosidades');
const CURIOSIDADES_PARCIAL = (CURIOSIDADES && CURIOSIDADES.CURIOSIDADES_PARCIAL) || [];
const fs = require('fs');
const path = require('path');

let sockRef = null;

// Paleta do card no modo parcial: amarelo sólido + texto escuro (nada de
// branco sobre amarelo — ilegível). Passada como theme sintético para
// generateMenuImage (não entra no catálogo themes.js, então !tema não lista).
// Contraste alvo: texto/fundo ≥ 7:1, badge ≥ 5:1.
const SPLASH_PARCIAL_THEME = {
    id: 'parcial',
    colors: {
        bg0: '#ffd23f',
        bg1: '#f59e0b',
        accent: '#7c4a00',
        text: '#231a00',
        sub: '#503c00',
        badgeText: '#ffd23f'
    }
};

// Grupo está em modo parcial? (lazy require como _cfg(): evita ciclo,
// já que database/utils não depende deste módulo em load-time.)
function isPartialSplashJid(jid) {
    if (!jid || !String(jid).endsWith('@g.us')) return false;
    try {
        return !!require('../database/utils').isPartialActive(jid);
    } catch (_) { return false; }
}

// Offset inicial por hash do jid: grupos diferentes começam em curiosidades
// diferentes em vez de todos na #0.
function _initialIdx(jid, len) {
    if (!len) return 0;
    let hash = 0;
    const s = String(jid || '');
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return hash % len;
}

// Anti-spam: 1x a cada 6h + mínimo de 60 mensagens por grupo.
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MIN_MESSAGES = 60;

// jid -> { count, idx, lastSentAt }
const counters = new Map();
const MAX_GROUPS = 1000;

// Persistência do anti-spam (lastSentAt/count) para sobreviver a restart.
// Sem isso, reiniciar o bot zeraria a janela de 6h e daria spam.
const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'splash-state.json');
let _stateLoaded = false;
let _saveTimer = null;

function _loadState() {
    if (_stateLoaded) return;
    _stateLoaded = true;
    try {
        if (!fs.existsSync(STATE_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8') || '{}');
        for (const [jid, v] of Object.entries(raw)) {
            if (!jid || !String(jid).endsWith('@g.us')) continue;
            counters.set(jid, {
                count: Math.max(0, Number(v.count) || 0),
                idx: Number.isFinite(Number(v.idx)) ? Number(v.idx) : 0,
                idxParcial: Number.isFinite(Number(v.idxParcial)) ? Number(v.idxParcial) : _initialIdx(jid, CURIOSIDADES_PARCIAL.length || 1),
                lastSentAt: Math.max(0, Number(v.lastSentAt) || 0)
            });
            if (counters.size >= MAX_GROUPS) break;
        }
    } catch (_) {}
}

function _saveState() {
    try {
        const dir = path.dirname(STATE_FILE);
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
        const obj = {};
        for (const [jid, e] of counters) obj[jid] = { count: e.count, idx: e.idx, idxParcial: e.idxParcial || 0, lastSentAt: e.lastSentAt };
        fs.writeFileSync(STATE_FILE, JSON.stringify(obj), 'utf8');
    } catch (_) {}
}

function _scheduleSave() {
    if (_saveTimer) return;
    _saveTimer = setTimeout(() => { _saveTimer = null; try { _saveState(); } catch (_) {} }, 2000);
    if (_saveTimer.unref) _saveTimer.unref();
}

try { _loadState(); } catch (_) {}

function attachSock(sock) { sockRef = sock; }

function _cfg() {
    try {
        const { readConfig } = require('../database/utils');
        return readConfig();
    } catch (_) { return {}; }
}

function getInterval() {
    const cfg = _cfg();
    const n = Number(cfg.splashInterval) || MIN_MESSAGES;
    // Mínimo de 60 mensagens por grupo (anti-spam), teto 200.
    return Math.max(MIN_MESSAGES, Math.min(200, n));
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
    // Padrão e piso: 6h. Teto: 24h. Valores antigos menores (ex: 90s)
    // são elevados para 6h para respeitar o anti-spam.
    if (!Number.isFinite(n) || n < SIX_HOURS_MS) return SIX_HOURS_MS;
    return Math.min(MAX_COOLDOWN_MS, n);
}

function getMinMessages() { return MIN_MESSAGES; }
function getMaxPerWindow() { return 1; }

function _entry(jid) {
    _loadState();
    let e = counters.get(jid);
    if (!e) {
        e = {
            count: 0,
            idx: CURIOSIDADES.length ? _initialIdx(jid, CURIOSIDADES.length) : 0,
            idxParcial: CURIOSIDADES_PARCIAL.length ? _initialIdx(jid, CURIOSIDADES_PARCIAL.length) : 0,
            lastSentAt: 0
        };
        if (counters.size >= MAX_GROUPS && !counters.has(jid)) {
            const oldest = counters.keys().next().value;
            counters.delete(oldest);
        }
        counters.set(jid, e);
    }
    // Entradas antigas (persistidas antes do pool parcial) não têm idxParcial.
    if (!Number.isFinite(Number(e.idxParcial))) {
        e.idxParcial = CURIOSIDADES_PARCIAL.length ? _initialIdx(jid, CURIOSIDADES_PARCIAL.length) : 0;
    }
    return e;
}

function pickNext(jid) {
    const e = _entry(jid);
    // Modo parcial: pool filtrado (só comandos liberados no parcial).
    if (isPartialSplashJid(jid) && CURIOSIDADES_PARCIAL.length) {
        const texto = CURIOSIDADES_PARCIAL[e.idxParcial % CURIOSIDADES_PARCIAL.length];
        e.idxParcial = (e.idxParcial + 1) % CURIOSIDADES_PARCIAL.length;
        return texto;
    }
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
    _loadState();
    const e = counters.get(jid);
    return e ? e.count : 0;
}

function getLastSentAt(jid) {
    _loadState();
    const e = counters.get(jid);
    return e ? (e.lastSentAt || 0) : 0;
}

function getTimeRemainingMs(jid) {
    const last = getLastSentAt(jid);
    if (!last) return 0;
    return Math.max(0, getCooldownMs() - (Date.now() - last));
}

// Anti-spam do !splash teste (manual): 30s por grupo. O teste NÃO consome a
// janela de 6h do automático, mas sem esse freio um duplo-toque inundava o grupo.
const _testeLast = new Map(); // jid -> timestamp
const TESTE_COOLDOWN_MS = 30 * 1000;
function checkTesteCooldown(jid) {
    if (!jid) return 0;
    const now = Date.now();
    const last = _testeLast.get(jid) || 0;
    if (now - last < TESTE_COOLDOWN_MS) return last + TESTE_COOLDOWN_MS - now;
    _testeLast.set(jid, now);
    return 0;
}

function reset(jid) {
    _loadState();
    // ATENÇÃO: reset zera SÓ o contador de mensagens, NÃO o cooldown de 6h.
    // Apagar o lastSentAt aqui permitiria 2 envios automáticos em <6h
    // (ex: auto às 10h + reset às 11h + 60 msgs = 2º auto às 11h). Por isso preserva.
    if (jid) {
        const e = counters.get(jid);
        if (e) {
            e.count = 0;
            // mantém e.lastSentAt e e.idx
        } else {
            counters.delete(jid);
        }
    }
    else counters.clear();
    try { _saveState(); } catch (_) {}
}

function buildCaption(curiosidade, prefix, botName, opts = {}) {
    const p = prefix || '!';
    // No parcial o !menu é bloqueado — sugere !statusp (bypass do parcial).
    const parcial = !!opts.parcial;
    const lines = [
        parcial ? '🟡 *MODO PARCIAL — VOCÊ SABIA?*' : '💡 *VOCÊ SABIA?*',
        '',
        `_${curiosidade}_`,
        '',
        parcial
            ? `📖 Digite *${p}statusp* para ver a saúde do *${botName || 'bot'}*`
            : `📖 Digite *${p}menu* para ver os comandos do *${botName || 'bot'}*`
    ];
    return lines.join('\n');
}

async function sendSplash(sock, jid, { curiosidade, prefix, quoted } = {}) {
    const s = sock || sockRef;
    if (!s || !jid) return false;
    const cfg = _cfg();
    // Modo parcial: pool filtrado + card amarelo (ignora o tema do grupo).
    const parcial = isPartialSplashJid(jid);
    const text = curiosidade || pickNext(jid);
    if (!text) return false;
    const caption = buildCaption(text, prefix || cfg.prefix, cfg.botName, { parcial });

    if (withImage()) {
        try {
            const { generateMenuImage, getRawGroupBuffer } = require('./menuImage');
            const { getTheme } = require('./themes');
            const utils = require('../database/utils');
            let groupName = 'Grupo';
            let memberLabel = '';
            let avatarRaw = null;
            let theme = null;
            let noCover = false;
            try {
                const meta = await utils.groupMetadataCached(s, jid).catch(() => null);
                if (meta?.subject) groupName = meta.subject;
                const n = Array.isArray(meta?.participants) ? meta.participants.length : 0;
                if (n > 0) memberLabel = `${n} membros`;
            } catch (_) {}
            try { avatarRaw = await getRawGroupBuffer(s, jid).catch(() => null); } catch (_) { avatarRaw = null; }
            if (parcial) {
                // Card amarelo sólido (sem foto de fundo/véu escuro) + texto escuro:
                // garante legibilidade do amarelo.
                theme = SPLASH_PARCIAL_THEME;
                noCover = true;
            } else {
                try {
                    const themeId = typeof utils.getThemeForJid === 'function' ? utils.getThemeForJid(jid) : 'default';
                    theme = getTheme(themeId);
                } catch (_) { theme = null; }
            }
            const card = await generateMenuImage({
                title: parcial ? 'MODO PARCIAL' : 'VOCÊ SABIA?',
                headerEmoji: parcial ? '🟡' : '💡',
                groupName,
                memberLabel,
                tagline: String(text).slice(0, 90),
                footer: parcial ? 'SPLASH PARCIAL' : 'SPLASH DO BOT',
                badge: parcial ? 'PARCIAL' : 'DICA',
                theme,
                avatarRaw,
                noCover
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
// Regra anti-spam: dispara no máximo 1x por janela (padrão 6h) E só se o grupo
// tiver pelo menos `interval` (mínimo 60) mensagens desde o último envio.
// Depois que aparece na janela, não aparece mais até a janela vencer.
// Retorna true se disparou o splash.
async function handleMessage(sock, jid, { prefix } = {}) {
    if (!jid || !String(jid).endsWith('@g.us')) return false;
    if (!isEnabled()) return false;
    const e = _entry(jid);
    e.count += 1;
    _scheduleSave();
    const interval = getInterval();
    if (e.count < interval) return false;
    // Janela anti-spam: já apareceu nas últimas 6h? segura no teto e não envia.
    const now = Date.now();
    if (now - (e.lastSentAt || 0) < getCooldownMs()) {
        e.count = interval; // segura no teto até a janela passar
        _scheduleSave();
        return false;
    }
    e.count = 0;
    e.lastSentAt = now;
    // Persistência IMEDIATA (síncrona): o debounce de 2s (_scheduleSave) deixava
    // uma janela onde crash/restart entre o envio e o save perdia o lastSentAt
    // e liberava um 2º envio dentro da janela de 6h. Contador usa debounce, cooldown não.
    try { _saveState(); } catch (_) {}
    _scheduleSave();
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
    getLastSentAt,
    getTimeRemainingMs,
    checkTesteCooldown,
    TESTE_COOLDOWN_MS,
    reset,
    isEnabled,
    getInterval,
    getCooldownMs,
    getMinMessages,
    getMaxPerWindow,
    SIX_HOURS_MS,
    MAX_COOLDOWN_MS,
    MIN_MESSAGES,
    CURIOSIDADES_PARCIAL,
    SPLASH_PARCIAL_THEME,
    isPartialSplashJid,
    _counters: counters
};
