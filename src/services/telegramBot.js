require('dotenv').config();
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
        const payload = {
            chat_id: chatId || _getAllowedChatId(),
            text: String(text).slice(0, 4000),
            ...opts.extra
        };
        if (opts.parseMode !== null) payload.parse_mode = opts.parseMode || 'Markdown';
        const res = await api.post('/sendMessage', payload);
        return { ok: !!res.data?.ok };
    } catch (e) {
        console.warn(`⚠️ [telegramBot] send falhou: ${e.response?.data?.description || e.message}`);
        return { ok: false, error: e.message };
    }
}

async function sendDocument(chatId, buffer, filename, caption, opts = {}) {
    const api = _getApi();
    if (!api) return { ok: false, error: 'not_configured' };
    try {
        const form = new FormData();
        form.append('chat_id', String(chatId || _getAllowedChatId()));
        form.append('document', new Blob([buffer], { type: 'application/zip' }), filename || 'dump.zip');
        if (caption) {
            form.append('caption', String(caption).slice(0, 1024));
            form.append('parse_mode', opts.parseMode || 'Markdown');
        }
        const res = await api.post('/sendDocument', form);
        return { ok: !!res.data?.ok };
    } catch (e) {
        console.warn(`⚠️ [telegramBot] sendDocument falhou: ${e.response?.data?.description || e.message}`);
        return { ok: false, error: e.response?.data?.description || e.message };
    }
}

function isAuthorized(chatId) {
    const allowed = _getAllowedChatId();
    if (!allowed) return false;
    return String(chatId) === String(allowed);
}

async function downloadTelegramFile(fileId) {
    const api = _getApi();
    if (!api) return { ok: false, error: 'not_configured' };
    try {
        const info = await api.get('/getFile', { params: { file_id: fileId } });
        const filePath = info.data?.result?.file_path;
        if (!filePath) return { ok: false, error: 'file_path vazio' };
        const url = `https://api.telegram.org/file/bot${_getToken()}/${filePath}`;
        const resp = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000,
            maxContentLength: 12 * 1024 * 1024
        });
        if (!resp.data) return { ok: false, error: 'download vazio' };
        const buf = Buffer.from(resp.data);
        if (buf.length < 100) return { ok: false, error: 'arquivo muito pequeno' };
        return { ok: true, buffer: buf };
    } catch (e) {
        return { ok: false, error: e.response?.data?.description || e.message };
    }
}

async function fanOutBroadcast(chatId, makePayload, label) {
    const utils = require('../database/utils');
    const groups = utils.listActiveGroups();
    if (!groups.length) { await send(chatId, `⚠️ Nenhum grupo ativo`); return; }
    const sock = global.__baileysSock;
    if (!sock) { await send(chatId, `❌ Baileys desconectado`); return; }
    await send(chatId, `📢 Broadcast ${label || ''}para ${groups.length} grupos...`);
    let sent = 0, failed = 0;
    for (const jid of groups) {
        try { await sock.sendMessage(jid, makePayload(jid)); sent++; } catch (_) { failed++; }
        await new Promise(r => setTimeout(r, 1500));
    }
    await send(chatId, `✅ Broadcast ok: ${sent} enviados, ${failed} falhas`);
}

async function handleUpdate(update) {
    const msg = update.message || update.edited_message;
    if (!msg) return;
    const chatId = msg.chat?.id;
    if (!chatId) return;

    if (!isAuthorized(chatId)) {
        const preview = (msg.text || msg.caption || '').trim();
        try { await send(chatId, `⛔ Não autorizado. Seu chatId: \`${chatId}\``, { parseMode: 'Markdown' }); } catch (_) {}
        console.warn(`⚠️ [telegramBot] acesso negado chat ${chatId}: ${preview.slice(0,80)}`);
        return;
    }

    // Foto com legenda /broadcast => broadcast de imagem + texto para os grupos
    const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
    if (photo) {
        const caption = (msg.caption || '').trim();
        if (!caption.toLowerCase().startsWith('/broadcast')) {
            await send(chatId, `🖼️ Para enviar imagem aos grupos, envie a foto com a legenda \`/broadcast <texto>\``);
            return;
        }
        const spaceIdx = caption.indexOf(' ');
        const legenda = spaceIdx === -1 ? '' : caption.slice(spaceIdx + 1).trim();
        await send(chatId, `⬇️ Baixando imagem...`);
        const dl = await downloadTelegramFile(photo.file_id);
        if (!dl.ok) { await send(chatId, `❌ Falha ao baixar imagem: ${dl.error}`, { parseMode: null }); return; }
        await fanOutBroadcast(chatId, () => (legenda ? { image: dl.buffer, caption: legenda } : { image: dl.buffer }), 'com imagem ');
        return;
    }

    if (!msg.text) return;
    const text = msg.text.trim();

    const lower = text.toLowerCase();
    const args = text.split(/\s+/).slice(1);

    // /help /start
    if (lower === '/start' || lower === '/help' || lower.startsWith('/help ')) {
        const help = [
            `*🤖 Gravity Bot — Comandos Telegram*`,
            ``,
            `/status — saúde do bot (ws, zumbi, grupos, uptime, banco)`,
            `/modo — mostra banco atual (local x nuvem)`,
            `/banco <local|nuvem> — alterna entre bot.db local e Supabase`,
            `/local — atalho p/ \`/banco local\``,
            `/nuvem — atalho p/ \`/banco nuvem\``,
            `/restart — \`process.exit(1)\` + Docker restart:always`,
            `/reconnect — força \`ws.close()\` → reconecta Baileys`,
            `/qr — mostra status do QR / conexão`,
            `/ativar <jid> — ativa grupo (ex: 120363...@g.us)`,
            `/desativar <jid> — desativa grupo`,
            `/broadcast <texto> — envia para todos os grupos ativos`,
            `foto com legenda /broadcast <texto> — broadcast com imagem`,
            `/logs — últimos logs do terminal`,
            `/dump — gera e envia backup (bot.db, .env com API keys, uploads)`,
            `/help — esta ajuda`
        ].join('\n');
        await send(chatId, help);
        return;
    }

    // /modo /banco /local /nuvem — alterna banco local x remoto (Supabase)
    if (lower === '/modo' || lower.startsWith('/modo ') || lower === '/banco' || lower.startsWith('/banco ')
        || lower === '/local' || lower.startsWith('/local ') || lower === '/nuvem' || lower.startsWith('/nuvem ')
        || lower === '/remoto' || lower.startsWith('/remoto ') || lower === '/cloud' || lower.startsWith('/cloud ')) {
        try {
            const sync = require('../database/supabaseSync');
            const fmtTs = (ts) => {
                if (!ts) return 'nunca';
                try { return new Date(ts).toLocaleString('pt-BR'); } catch (_) { return String(ts); }
            };
            const modeText = () => {
                const m = (typeof sync.getMode === 'function') ? sync.getMode() : { ...sync.status() };
                const nome = m.local ? '📀 LOCAL (só bot.db)' : '☁️ NUVEM (Supabase)';
                return [
                    `*💾 BANCO ATUAL: ${m.local ? 'LOCAL' : 'NUVEM'}*`,
                    `${nome}`,
                    `Origem: \`${m.source || 'env'}\` env: \`${m.env || '?'}\``,
                    `Último pull: ${fmtTs(m.lastPullAt)}`,
                    `Último push: ${fmtTs(m.lastPushAt)}`,
                ].join('\n');
            };
            const doSwitch = async (toLocal) => {
                const cur = sync.isSyncKilled();
                if (cur === toLocal) {
                    await send(chatId, `${modeText()}\n\n⚠️ Já está em ${toLocal ? '*LOCAL*' : '*NUVEM*'}.`);
                    return;
                }
                try { require('../database/utils').flushNow?.(); } catch (_) {}
                const r = sync.setLocalMode(toLocal, { persist: true });
                console.warn(`🔀 [telegramBot] /banco → ${toLocal ? 'LOCAL' : 'NUVEM'} por ${chatId} (persistido: ${r.persisted ? 'sim' : 'não'})`);
                const extra = toLocal
                    ? `\n\n✅ Agora só \`bot.db\` local (sem pull/push).\nTroca salva no .env — sobrevive ao restart.`
                    : `\n\n✅ Sync retomado (push periódico, sem pull automático).\n⚠️ A nuvem NÃO sobrescreveu o local. Para forçar nuvem→local rode \`npm run db:pull\`. Troca salva no .env.`;
                await send(chatId, `${modeText()}${extra}`);
            };
            // só consulta
            if (lower === '/modo' || lower.startsWith('/modo ')) {
                await send(chatId, `${modeText()}\n\nUso: \`/banco local\` ou \`/banco nuvem\``);
                return;
            }
            // atalhos diretos
            if (lower === '/local' || lower.startsWith('/local ')) { await doSwitch(true); return; }
            if (lower === '/nuvem' || lower.startsWith('/nuvem ') || lower === '/remoto' || lower.startsWith('/remoto ')
                || lower === '/cloud' || lower.startsWith('/cloud ')) { await doSwitch(false); return; }
            // /banco [local|nuvem]
            const alvo = (args[0] || '').toLowerCase();
            if (!alvo) { await send(chatId, `${modeText()}\n\nUso: \`/banco local\` ou \`/banco nuvem\``); return; }
            if (['local', 'loc'].includes(alvo)) { await doSwitch(true); return; }
            if (['nuvem', 'remoto', 'cloud', 'supabase'].includes(alvo)) { await doSwitch(false); return; }
            await send(chatId, `❌ Uso: \`/banco local\` ou \`/banco nuvem\``);
        } catch (e) { await send(chatId, `❌ Erro banco: ${e.message}`); }
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
            const dbMode = (() => { try { return require('../database/supabaseSync').isSyncKilled() ? 'LOCAL' : 'NUVEM'; } catch (_) { return '?'; } })();
            const txt = [
                `*📊 STATUS*`,
                `Bot: \`${utils.readConfig().botName || '-'}\``,
                `Conexão: \`${dash?.status || '?'}\` phone: \`${dash?.phone || '-'}\``,
                `Banco: \`${dbMode}\` (/modo p/ detalhes)`,
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
            await fanOutBroadcast(chatId, () => ({ text: broadcastText }));
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

    if (lower === '/dump' || lower.startsWith('/dump ')) {
        try {
            await send(chatId, `📦 Gerando backup (inclui .env com API keys)...`);
            const { buildDumpZip, cleanupDumpZip } = require('./dump');
            const fs = require('fs');
            const { zipPath, zipName, includedNames, sizeKb } = buildDumpZip();
            try {
                const buf = fs.readFileSync(zipPath);
                const caption = `📦 Backup OK\n${includedNames.map(n => `• ${n}`).join('\n')}\n💾 ${sizeKb} KB\n⚠️ Contém .env com API keys — mantenha em local seguro.`;
                const r = await sendDocument(chatId, buf, zipName, caption);
                if (!r.ok) await send(chatId, `❌ Falha ao enviar dump: ${r.error}`, { parseMode: null });
            } finally {
                cleanupDumpZip(zipPath);
            }
        } catch (e) { await send(chatId, `❌ Erro dump: ${e.message}`, { parseMode: null }); }
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
    console.log(`🤖 [telegramBot] polling ativo → chat ${String(chat).slice(0,4)}**** cmds: /modo /banco /local /nuvem /restart /reconnect /qr /ativar /desativar /broadcast /logs /dump`);
    return _pollTimer;
}

function stop() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
}

module.exports = { start, stop, send, sendDocument, handleUpdate, isAuthorized };
