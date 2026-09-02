const axios = require('axios');

/**
 * Telegram Alerts — envia notificações críticas para o admin via Telegram.
 * Config via env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * Também lê de config DB: telegramBotToken, telegramChatId (prioridade: env > DB)
 */

let _token = null;
let _chatId = null;
let _axios = null;
let _lastSendAt = 0;
let _cooldownMs = 30000; // anti-spam mínimo entre alertas do mesmo tipo
const _lastByKey = new Map(); // key -> timestamp
let _enabledLogged = false;

function _getToken() {
    if (_token) return _token;
    _token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!_token) {
        try {
            const { readConfig } = require('../database/utils');
            const cfg = readConfig();
            _token = (cfg.telegramBotToken || '').trim();
        } catch (_) {}
    }
    return _token;
}

function _getChatId() {
    if (_chatId) return _chatId;
    const env = (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (env) { _chatId = env; return _chatId; }
    try {
        const { readConfig } = require('../database/utils');
        const cfg = readConfig();
        const v = String(cfg.telegramChatId || '').trim();
        if (v) _chatId = v;
    } catch (_) {}
    return _chatId;
}

function isConfigured() {
    return !!(_getToken() && _getChatId());
}

function configure({ token, chatId }) {
    if (token) { _token = String(token).trim(); process.env.TELEGRAM_BOT_TOKEN = _token; }
    if (chatId) { _chatId = String(chatId).trim(); process.env.TELEGRAM_CHAT_ID = _chatId; }
    if (_token && _chatId && !_enabledLogged) {
        _enabledLogged = true;
        console.log(`📲 [telegram] alertas ativados → chat ${_chatId.slice(0,4)}****`);
    }
}

function _getAxios() {
    if (_axios) return _axios;
    _axios = axios.create({ timeout: 10000 });
    return _axios;
}

/**
 * Envia mensagem formatada para o Telegram.
 * @param {string} text - Texto (Markdown ou plain)
 * @param {object} opts - { key, parseMode, disableNotification, cooldownMs }
 */
async function sendAlert(text, opts = {}) {
    const token = _getToken();
    const chatId = _getChatId();
    if (!token || !chatId) {
        if (!_enabledLogged) {
            // log once
            _enabledLogged = true;
            console.warn('⚠️ [telegram] não configurado — defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no .env');
        }
        return { ok: false, error: 'not_configured' };
    }
    const key = opts.key || 'default';
    const cooldown = opts.cooldownMs != null ? opts.cooldownMs : _cooldownMs;
    const now = Date.now();
    const last = _lastByKey.get(key) || 0;
    if (now - last < cooldown) {
        return { ok: false, error: 'cooldown', remaining: cooldown - (now - last) };
    }
    // global rate-limit mínimo 3s
    if (now - _lastSendAt < 3000) {
        await new Promise(r => setTimeout(r, 3000 - (now - _lastSendAt)));
    }
    _lastSendAt = Date.now();
    _lastByKey.set(key, _lastSendAt);

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: String(text).slice(0, 4000),
        parse_mode: opts.parseMode || 'Markdown',
        disable_notification: !!opts.disableNotification
    };
    // Remove parse_mode if plain
    if (opts.parseMode === null) delete payload.parse_mode;

    try {
        const res = await _getAxios().post(url, payload);
        if (res.data?.ok) return { ok: true };
        return { ok: false, error: res.data?.description || 'unknown' };
    } catch (e) {
        const msg = e.response?.data?.description || e.message || String(e);
        console.warn(`⚠️ [telegram] falha ao enviar (${key}): ${msg.slice(0,150)}`);
        return { ok: false, error: msg };
    }
}

function formatAlert({ title, botName, status, reason, uptime, extra }) {
    const ts = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const lines = [];
    lines.push(`*${escapeMd(title)}*`);
    if (botName) lines.push(`🤖 Bot: \`${escapeMd(botName)}\``);
    if (status) lines.push(`📡 Status: ${escapeMd(status)}`);
    if (reason) lines.push(`📝 Motivo: ${escapeMd(reason)}`);
    if (uptime) lines.push(`⏱️ Uptime: ${escapeMd(uptime)}`);
    lines.push(`🕐 ${escapeMd(ts)}`);
    if (extra) lines.push(`\n${escapeMd(extra)}`);
    return lines.join('\n');
}

function escapeMd(s) {
    return String(s || '').replace(/[_*`\[\]]/g, '\\$&');
}

// Atalhos tipados
async function notifyZombie({ botName, idleMs, wsState, reason }) {
    const mins = Math.round(idleMs / 60000);
    return sendAlert(
        formatAlert({
            title: '🚨 BOT ZUMBI DETECTADO',
            botName,
            status: `ZUMBI — sem mensagens há ${mins}min`,
            reason: reason || `ws=${wsState || '?'} idle=${mins}min`,
            extra: 'Tentando reconectar automaticamente... Se persistir, verifique logs/dashboard.'
        }),
        { key: 'zombie', cooldownMs: 5 * 60 * 1000 }
    );
}

async function notifyDisconnect({ botName, code, reasonName, phone }) {
    return sendAlert(
        formatAlert({
            title: '🔌 BOT DESCONECTADO',
            botName,
            status: `Desconectado (code=${code} ${reasonName})`,
            reason: phone ? `phone ${phone}` : undefined,
            extra: 'Reconectando em 5s...'
        }),
        { key: 'disconnect', cooldownMs: 60 * 1000 }
    );
}

async function notifyConnected({ botName, phone, version }) {
    return sendAlert(
        formatAlert({
            title: '🟢 BOT RECONECTADO',
            botName,
            status: `Conectado ✅`,
            reason: `phone ${phone || '?'} • ${version || ''}`,
            extra: 'Bot voltou a receber comandos.'
        }),
        { key: 'connected', cooldownMs: 60 * 1000 }
    );
}

async function notifyQr({ botName, attempt }) {
    return sendAlert(
        formatAlert({
            title: '📱 QR CODE NECESSÁRIO',
            botName,
            status: `QR #${attempt} gerado`,
            extra: 'Escaneie o QR no dashboard ou terminal para reconectar.'
        }),
        { key: 'qr', cooldownMs: 2 * 60 * 1000 }
    );
}

async function notifyError({ botName, error }) {
    return sendAlert(
        formatAlert({
            title: '💥 ERRO CRÍTICO',
            botName,
            status: 'Erro fatal / exception',
            reason: String(error).slice(0,300),
            extra: 'Processo será reiniciado se restart:always estiver ativo.'
        }),
        { key: 'error', cooldownMs: 2 * 60 * 1000 }
    );
}

// Log de interação/comando (básico, sem toggle)
async function notifyCommand({ botName, commandName, prefix, senderName, sender, group, args, elapsed }) {
    const cmd = `${prefix || '!'}${commandName || '?'}`;
    const who = senderName ? `${senderName} (${(sender||'').split('@')[0]})` : (sender||'').split('@')[0];
    const where = group || 'privado';
    const extra = args ? `Args: ${String(args).slice(0,200)}` : null;
    const lines = [
        `*⌨️ COMANDO* \`${escapeMd(cmd)}\``,
        `👤 ${escapeMd(who)}`,
        `👥 ${escapeMd(where)}`,
        elapsed != null ? `⏱️ ${elapsed}ms` : null,
        extra ? `📝 ${escapeMd(extra)}` : null,
        `🤖 ${escapeMd(botName||'')}`,
        `🕐 ${escapeMd(new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}))}`
    ].filter(Boolean).join('\n');
    return sendAlert(lines, { key: `cmd:${commandName}`, cooldownMs: 0, parseMode: 'Markdown' });
}

// Teste manual
async function test() {
    return sendAlert(
        formatAlert({
            title: '✅ TESTE TELEGRAM',
            botName: 'Antigravity Bot',
            status: 'Alerta de teste OK',
            reason: 'Se recebeu esta mensagem, os alertas estão funcionando!',
            extra: 'Você receberá avisos de: zumbi, desconexão e reconexão.'
        }),
        { key: 'test', cooldownMs: 0 }
    );
}

module.exports = {
    isConfigured,
    configure,
    sendAlert,
    notifyZombie,
    notifyDisconnect,
    notifyConnected,
    notifyQr,
    notifyError,
    notifyCommand,
    test,
    formatAlert
};
