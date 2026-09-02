const axios = require('axios');

let _pollTimer = null;
let _offset = 0;
let _running = false;
let _token = null;
let _allowedChatId = null;
let _api = null;

function _getToken() {
    if (_token) return _token;
    _token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if (!_token) {
        try { _token = (require('../database/utils').readConfig().telegramBotToken || '').trim(); } catch (_) {}
    }
    return _token;
}
function _getAllowedChatId() {
    if (_allowedChatId) return _allowedChatId;
    const env = (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (env) { _allowedChatId = String(env); return _allowedChatId; }
    try { _allowedChatId = String(require('../database/utils').readConfig().telegramChatId || '').trim(); } catch (_) {}
    return _allowedChatId;
}
function _getApi() {
    if (_api) return _api;
    const t = _getToken();
    if (!t) return null;
    _api = axios.create({ baseURL: `https://api.telegram.org/bot${t}`, timeout: 40000 });
    return _api;
}

async function send(chatId, text, opts = {}) {
    const api = _getApi();
    if (!api) return { ok: false, error: 'not_configured' };
    try {
        const res = await api.post('/sendMessage', {
            chat_id: chatId || _getAllowedChatId(),
            text: String(text).slice(0, 4000),
            parse_mode: opts.parseMode || 'Markdown',
            ...opts.extra
        });
        return { ok: !!res.data?.ok };
    } catch (e) {
        console.warn(`⚠️ [telegramBot] send falhou: ${e.response?.data?.description || e.message}`);
        return { ok: false, error: e.message };
    }
}

function isAuthorized(chatId) {
    const allowed = _getAllowedChatId();
    if (!allowed) return false;
    return String(chatId) === String(allowed);
}

async function handleUpdate(update) {
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return;
    const chatId = msg.chat?.id;
    const text = msg.text.trim();
    if (!chatId) return;

    if (!isAuthorized(chatId)) {
        try { await send(chatId, `⛔ Não autorizado. Seu chatId: \`${chatId}\``, { parseMode: 'Markdown' }); } catch (_) {}
        console.warn(`⚠️ [telegramBot] acesso negado chat ${chatId}: ${text.slice(0,80)}`);
        return;
    }

    const lower = text.toLowerCase();
    const args = text.split(/\s+/).slice(1);

    // /help /start
    if (lower === '/start' || lower === '/help' || lower.startsWith('/help ')) {
        const help = [
            `*🤖 Antigravity Bot — Comandos Telegram*`,
            ``,
            `/status — saúde do bot (ws, zumbi, grupos, uptime)`,
            `/restart — \`process.exit(1)\` + Docker restart:always`,
            `/reconnect — força \`ws.close()\` → reconecta Baileys`,
            `/qr — mostra status do QR / conexão`,
            `/ativar <jid> — ativa grupo (ex: 120363...@g.us)`,
            `/desativar <jid> — desativa grupo`,
            `/broadcast <texto> — envia para todos os grupos ativos`,
            `/logs — últimos logs do terminal`,
            `/help — esta ajuda`
        ].join('\n');
        await send(chatId, help);
        return;
    }

    if (lower === '/status' || lower.startsWith('/status ')) {
        try {
            const wd = require('./watchdog').getState();
            const dash = (() => { try { return require('../dashboard/dashboard').getConnectionState(); } catch (_) { return null; } })();
            const utils = require('../database/utils');
            const stats = utils.readStats();
            const ag = utils.listActiveGroups().length;
            const pg = utils.listPartialGroups().length;
            const uptime = (() => {
                const ms = Date.now() - (global.__startTime || Date.now());
                const s = Math.floor(ms/1000); const h=Math.floor(s/3600), m=Math.floor((s%3600)/60); return `${h}h ${m}m`;
            })();
            const txt = [
                `*📊 STATUS*`,
                `Bot: \`${utils.readConfig().botName || '-'}\``,
                `Conexão: \`${dash?.status || '?'}\` phone: \`${dash?.phone || '-'}\``,
                `WS: \`${wd.wsState || '?'}\` zumbi: \`${wd.isZombie ? 'SIM 🚨' : 'não'}\` idle: ${Math.round(wd.idleMs/1000)}s`,
                `Grupos: ativos ${ag} + parciais ${pg}`,
                `Comandos: ${stats.totalCommands||0} restarts: ${stats.totalRestarts||0}`,
                `Uptime: ${uptime}`,
                `Queue: pending ${wd.queue?.pending||0} (dl:${wd.queue?.download||0} send:${wd.queue?.send||0} proc:${wd.queue?.process||0})`
            ].join('\n');
            await send(chatId, txt);
        } catch (e) { await send(chatId, `❌ Erro status: ${e.message}`); }
        return;
    }

    if (lower === '/restart' || lower.startsWith('/restart ')) {
        await send(chatId, `🔄 Reiniciando bot (process.exit) — Docker vai subir em ~5s...`);
        console.warn('🔄 [telegramBot] /restart por', chatId);
        try { require('../database/utils').flushNow?.(); } catch (_) {}
        setTimeout(() => process.exit(1), 1200).unref();
        return;
    }

    if (lower === '/reconnect' || lower.startsWith('/reconnect ')) {
        const sock = global.__baileysSock;
        if (!sock) { await send(chatId, `⚠️ Baileys não conectado (sock nulo)`); return; }
        try {
            await send(chatId, `🔌 Forçando reconnect (ws.close)...`);
            try { if (sock.ws?.close) sock.ws.close(); else if (sock.ws?.socket?.close) sock.ws.socket.close(); } catch (_) {}
            try { if (typeof sock.end === 'function') sock.end(new Error('telegram /reconnect')); } catch (_) {}
            console.log('🔌 [telegramBot] /reconnect executado');
        } catch (e) { await send(chatId, `❌ Falha reconnect: ${e.message}`); }
        return;
    }

    if (lower === '/qr' || lower.startsWith('/qr ')) {
        try {
            const dash = require('../dashboard/dashboard').getConnectionState();
            const qrCtrl = global.__qrControl;
            const attempts = qrCtrl ? `${qrCtrl.getAttempts()}/${qrCtrl.getMaxAttempts()}` : '?';
            let txt = `*📱 QR STATUS*\nStatus: \`${dash.status}\`\nPhone: \`${dash.phone||'-'}\`\nTentativas: \`${attempts}\``;
            if (dash.qr) txt += `\n\nQR disponível no dashboard. Use http://localhost:3000 ou painel admin.`;
            await send(chatId, txt);
        } catch (e) { await send(chatId, `❌ Erro qr: ${e.message}`); }
        return;
    }

    if (lower.startsWith('/ativar ') || lower.startsWith('/desativar ')) {
        const isAtivar = lower.startsWith('/ativar ');
        const jid = args[0]?.trim();
        if (!jid || !jid.endsWith('@g.us')) { await send(chatId, `❌ Uso: \`${isAtivar ? '/ativar' : '/desativar'} 120363...@g.us\``); return; }
        try {
            const utils = require('../database/utils');
            const ok = isAtivar ? utils.activateGroup(jid) : utils.deactivateGroup(jid);
            await send(chatId, ok ? `✅ ${isAtivar ? 'Ativado' : 'Desativado'}: \`${jid}\`` : `⚠️ Já ${isAtivar ? 'ativo' : 'inativo'} ou falha: \`${jid}\``);
        } catch (e) { await send(chatId, `❌ Erro: ${e.message}`); }
        return;
    }

    if (lower.startsWith('/broadcast ')) {
        const broadcastText = text.slice(text.indexOf(' ') + 1).trim();
        if (!broadcastText) { await send(chatId, `❌ Uso: \`/broadcast <texto>\``); return; }
        try {
            const utils = require('../database/utils');
            const groups = utils.listActiveGroups();
            if (!groups.length) { await send(chatId, `⚠️ Nenhum grupo ativo`); return; }
            await send(chatId, `📢 Broadcast para ${groups.length} grupos...`);
            const sock = global.__baileysSock;
            if (!sock) { await send(chatId, `❌ Baileys desconectado`); return; }
            let sent = 0, failed = 0;
            for (const jid of groups) {
                try { await sock.sendMessage(jid, { text: broadcastText }); sent++; } catch (_) { failed++; }
                await new Promise(r => setTimeout(r, 1500));
            }
            await send(chatId, `✅ Broadcast ok: ${sent} enviados, ${failed} falhas`);
        } catch (e) { await send(chatId, `❌ Erro broadcast: ${e.message}`); }
        return;
    }

    if (lower === '/logs' || lower.startsWith('/logs ')) {
        try {
            const n = Math.min(20, Math.max(5, parseInt(args[0]||'10',10)||10));
            const logs = require('./terminalLog').getLast(n);
            if (!logs.length) { await send(chatId, `📭 Sem logs`); return; }
            const txt = logs.map(l => `[${l.time}] ${l.text.slice(0,200)}`).join('\n').slice(0, 3800);
            await send(chatId, `*📜 Últimos ${logs.length} logs:*\n\`\`\`\n${txt}\n\`\`\``);
        } catch (e) { await send(chatId, `❌ Erro logs: ${e.message}`); }
        return;
    }

    // fallback: eco help
    await send(chatId, `❓ Comando desconhecido: \`${text.slice(0,40)}\`\nUse /help`);
}

async function pollOnce() {
    if (_running) return;
    _running = true;
    try {
        const api = _getApi();
        if (!api) return;
        const res = await api.get('/getUpdates', { params: { offset: _offset, timeout: 25, allowed_updates: JSON.stringify(['message','edited_message']) } });
        const updates = res.data?.result || [];
        for (const u of updates) {
            _offset = Math.max(_offset, (u.update_id || 0) + 1);
            try { await handleUpdate(u); } catch (e) { console.warn('[telegramBot] handleUpdate erro:', e.message); }
        }
    } catch (e) {
        const msg = e.response?.data?.description || e.message || String(e);
        // timeout de long-poll sem mensagens é normal — não polui log
        if (e.code === 'ECONNABORTED' || String(msg).toLowerCase().includes('timeout')) {
            // silêncio: apenas aguarda próximo ciclo
            await new Promise(r => setTimeout(r, 1000));
        } else if (String(msg).includes('409') || String(msg).includes('conflict')) {
            console.warn('⚠️ [telegramBot] polling conflito 409 — aguardando 10s');
            await new Promise(r => setTimeout(r, 10000));
        } else {
            console.warn(`⚠️ [telegramBot] poll falhou: ${msg.slice(0,120)}`);
            await new Promise(r => setTimeout(r, 3000));
        }
    } finally { _running = false; }
}

function start(opts = {}) {
    const tok = (opts.token || _getToken() || '').trim();
    const chat = (opts.chatId || _getAllowedChatId() || '').trim();
    if (!tok || !chat) {
        console.warn('⚠️ [telegramBot] não iniciado — sem TELEGRAM_BOT_TOKEN/CHAT_ID');
        return null;
    }
    _token = tok; _allowedChatId = String(chat);
    _api = axios.create({ baseURL: `https://api.telegram.org/bot${_token}`, timeout: 40000 });
    if (_pollTimer) clearInterval(_pollTimer);
    // polling a cada 3s + long poll 25s
    _pollTimer = setInterval(() => pollOnce().catch(()=>{}), 3000);
    if (_pollTimer.unref) _pollTimer.unref();
    // primeira chamada imediata
    pollOnce().catch(()=>{});
    console.log(`🤖 [telegramBot] polling ativo → chat ${String(chat).slice(0,4)}**** cmds: /restart /reconnect /qr /ativar /desativar /broadcast`);
    return _pollTimer;
}

function stop() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
}

module.exports = { start, stop, send, handleUpdate, isAuthorized };
