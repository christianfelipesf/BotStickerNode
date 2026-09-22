/**
 * humanize.js — Modo Humanizado / Anti-ban
 *
 * Objetivo: fazer o Baileys parecer um humano no WhatsApp para reduzir
 * risco de ban por detecção de automação:
 *
 *  - "digitando..." (composing) / "gravando..." (recording) antes de responder
 *  - delay proporcional ao tamanho da resposta + jitter aleatório
 *  - marca mensagem como lida (blue ticks) antes de responder, como humano
 *  - throttle global entre envios (evita rajadas que entregam bot)
 *  - pausa presença após enviar (volta p/ "paused")
 *  - pula humanização p/ reações, deletes, protocolo (rápidos como humano)
 *
 * Tudo é controlado por config (liga/desliga em runtime via !humanizar):
 *   humanMode (bool, default true)
 *   humanMinDelayMs / humanMaxDelayMs / humanMsPerChar / humanMaxTypingMs
 *   humanPresence (bool) — envia composing/recording
 *   humanReadReceipt (bool) — dá "lido" antes de responder
 *   humanThrottleMs — intervalo mínimo entre envios
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * Math.max(0, max - min));

function readCfg() {
    try {
        return require('../database/utils').readConfig();
    } catch (_) {
        return {};
    }
}

function isHumanMode(cfg) {
    const c = cfg || readCfg();
    // Default LIGADO (pedido do dono). Só desliga se explicitamente false.
    return c.humanMode !== false;
}

function getHumanSettings(cfg) {
    const c = cfg || readCfg();
    return {
        enabled: isHumanMode(c),
        minDelayMs: Math.max(300, Number(c.humanMinDelayMs) || 1200),
        maxDelayMs: Math.max(Number(c.humanMinDelayMs) || 1200, Number(c.humanMaxDelayMs) || 3500),
        msPerChar: Math.min(120, Math.max(10, Number(c.humanMsPerChar) || 35)),
        maxTypingMs: Math.min(15000, Math.max(2000, Number(c.humanMaxTypingMs) || 8000)),
        presence: c.humanPresence !== false,
        readReceipt: c.humanReadReceipt !== false,
        throttleMs: Math.max(0, Number(c.humanThrottleMs) || 1500),
    };
}

/** Extrai tamanho aproximado do texto da mensagem p/ calcular "tempo de digitação". */
function _contentTextLen(content = {}) {
    try {
        if (typeof content.text === 'string') return content.text.length;
        if (typeof content.caption === 'string') return content.caption.length;
        if (content.poll?.name) return String(content.poll.name).length + 20;
        // mídia sem legenda: tempo curto fixo
        if (content.image || content.video || content.audio || content.sticker || content.document) return 40;
        return 30;
    } catch (_) {
        return 30;
    }
}

function _contentKind(content = {}) {
    if (content.audio || content.ptt) return 'recording';
    if (content.react || content.delete || content.protocolMessage) return 'none';
    if (content.poll || content.contacts || content.location) return 'none';
    return 'composing';
}

/** Delay "humano": proporcional ao texto + jitter, dentro de [min, max]. */
function humanDelayForLen(len, s) {
    const typed = Math.min(s.maxTypingMs, len * s.msPerChar);
    const base = Math.min(s.maxDelayMs, Math.max(s.minDelayMs, typed));
    // jitter ±30%
    const jitter = base * (0.7 + Math.random() * 0.6);
    return Math.round(Math.min(s.maxTypingMs + 1000, Math.max(400, jitter)));
}

async function _safePresence(sock, jid, presence) {
    try {
        if (sock?.sendPresenceUpdate) await sock.sendPresenceUpdate(presence, jid);
    } catch (_) {}
}

async function _safeRead(sock, key) {
    try {
        if (sock?.readMessages && key?.id) await sock.readMessages([key]);
    } catch (_) {}
}

// Throttle global entre envios (evita rajada = assinatura clássica de bot).
let _lastSendTs = 0;
async function _throttle(s) {
    if (!s.throttleMs) return;
    const now = Date.now();
    const wait = _lastSendTs + s.throttleMs - now;
    if (wait > 0) await sleep(wait + rand(0, 600));
}

/**
 * Simula comportamento humano ANTES de responder um comando:
 * marca como lido + mostra "digitando..." por um tempo proporcional.
 * Chame no message.js antes de executar o comando.
 */
async function preReply(sock, jid, incomingMsg, opts = {}) {
    try {
        const s = getHumanSettings(opts.config);
        if (!s.enabled) return;
        if (!jid || (!String(jid).endsWith('@g.us') && !String(jid).endsWith('@s.whatsapp.net') && !String(jid).endsWith('@lid'))) return;

        // 1) "lê" a mensagem como humano (pequena pausa antes do azulzinho)
        if (s.readReceipt && incomingMsg?.key && !incomingMsg.key.fromMe) {
            await sleep(rand(400, 1100));
            await _safeRead(sock, incomingMsg.key);
        }
        // 2) mostra digitando por 0.8–2.5s (só presença, o delay real do texto
        // acontece no wrap do sendMessage para não duplicar a espera)
        if (s.presence) {
            const kind = opts.kind || 'composing';
            if (kind !== 'none') {
                await _safePresence(sock, jid, kind);
                await sleep(rand(800, 2500));
            }
        }
    } catch (_) {}
}

/**
 * Envio humanizado direto (para quem quiser chamar explicitamente).
 * Se desligado, envia direto sem delay.
 */
async function sendHumanized(sock, jid, content, options = {}) {
    const raw = sock?.__rawSendMessage || sock?.sendMessage?.bind(sock);
    const s = getHumanSettings(options.config);
    if (!s.enabled || options.noHuman) return raw(jid, content, options.noHuman ? undefined : options);
    const kind = _contentKind(content);
    const cleanOpts = { ...options };
    delete cleanOpts.noHuman;
    delete cleanOpts.config;
    delete cleanOpts.kind;

    await _throttle(s);
    if (kind !== 'none' && s.presence) {
        await _safePresence(sock, jid, kind);
        await sleep(humanDelayForLen(_contentTextLen(content), s));
    } else {
        await sleep(rand(300, 900));
    }
    try {
        const res = await raw(jid, content, cleanOpts);
        return res;
    } finally {
        _lastSendTs = Date.now();
        // volta a presença p/ pausado (humano para de digitar depois de enviar)
        if (kind !== 'none' && s.presence) _safePresence(sock, jid, 'paused').catch(() => {});
    }
}

/**
 * Dá wrap no sock.sendMessage UMA vez: todos os comandos existentes
 * ganham anti-ban sem precisar editar 100 arquivos.
 * Reações/deletes passam direto (humanos reagem rápido).
 * Passe { __noHuman: true } nas options para pular (ex: watchdog interno).
 */
function wrapSocketForHumanMode(sock) {
    if (!sock || sock.__humanWrapped) return sock;
    const raw = sock.sendMessage.bind(sock);
    sock.__rawSendMessage = raw;
    sock.__humanWrapped = true;

    sock.sendMessage = async (jid, content = {}, options = {}) => {
        try {
            if (options && options.__noHuman) {
                const o = { ...options };
                delete o.__noHuman;
                return raw(jid, content, o);
            }
            const s = getHumanSettings();
            if (!s.enabled) return raw(jid, content, options);
            // Só humaniza conversa real (grupo/PV). Status/newsletter/broadcast: direto.
            const j = String(jid || '');
            const isChat = j.endsWith('@g.us') || j.endsWith('@s.whatsapp.net') || j.endsWith('@lid');
            if (!isChat) return raw(jid, content, options);

            const kind = _contentKind(content);
            if (kind === 'none') return raw(jid, content, options); // react/delete: instantâneo

            await _throttle(s);
            if (s.presence) {
                await _safePresence(sock, jid, kind);
                await sleep(humanDelayForLen(_contentTextLen(content), s));
            } else {
                await sleep(rand(500, 1200));
            }
            try {
                return await raw(jid, content, options);
            } finally {
                _lastSendTs = Date.now();
                if (s.presence) _safePresence(sock, jid, 'paused').catch(() => {});
            }
        } catch (e) {
            // fail-open: nunca quebra envio por causa da humanização
            try { return await raw(jid, content, options); } catch (e2) { throw e2; }
        }
    };
    return sock;
}

module.exports = {
    isHumanMode,
    getHumanSettings,
    humanDelayForLen,
    preReply,
    sendHumanized,
    wrapSocketForHumanMode,
};
