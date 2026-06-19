const http = require('http');
const { Server } = require('socket.io');

let ioServer = null;
let sockRef = null;
const dashboardLogs = []; // RAM
const MAX_LOGS = 500;

// Cache de mídia recente (por messageId): { buffer(base64), mime, type, fromJid }
// Usado para hidratar quotedMessage no /api/reply e mostrar viewOnce com mídia.
const mediaCache = new Map();
const MAX_CACHE = 60;

function cacheMedia(messageId, info) {
    if (!messageId) return;
    mediaCache.set(messageId, info);
    if (mediaCache.size > MAX_CACHE) {
        const firstKey = mediaCache.keys().next().value;
        mediaCache.delete(firstKey);
    }
}

function getCachedMedia(messageId) {
    return mediaId ? mediaCache.get(messageId) : null;
}

function attachSock(sock) { sockRef = sock; }

function init(config) {
    if (config.dashboardEnabled === false) return null;

    const port = config.dashboardPort || 3000;

    const server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        if (req.method === 'POST' && req.url === '/api/reply') {
            await readJsonBody(req, res, async (payload) => {
                try {
                    const r = await sendReply(payload);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(r));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        if (req.method === 'POST' && req.url === '/api/send') {
            await readJsonBody(req, res, async (payload) => {
                try {
                    const r = await sendDirect(payload);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(r));
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        if (req.method === 'GET' && req.url === '/api/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: !!sockRef }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHtml(config.botName));
    });

    ioServer = new Server(server);
    ioServer.on('connection', (socket) => socket.emit('history', dashboardLogs));

    server.listen(port, '0.0.0.0', () => console.log(`📊 Dashboard ativo em: http://localhost:${port}`));
    return ioServer;
}

function readJsonBody(req, res, cb) {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 32 * 1024 * 1024) req.destroy(); });
    req.on('end', () => {
        try { cb(JSON.parse(body || '{}')); }
        catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'JSON inválido' })); }
    });
}

// Constrói um quotedMessage completo a partir do cache (ou fallback textual).
// Sem isso, o WhatsApp exibe a citação "meio apagada" quando a mensagem original
// tinha mídia viewOnce/efêmera removida pelo próprio WhatsApp.
async function buildQuotedPayload(quotedId, quotedParticipant) {
    const cached = getCachedMedia(quotedId);
    if (cached && cached.bufferBase64) {
        const buf = Buffer.from(cached.bufferBase64, 'base64');
        const wrap = { key: { remoteJid: '__jid__', id: quotedId, participant: quotedParticipant || undefined }, message: {} };
        if (cached.type === 'image') wrap.message.imageMessage = { mimetype: cached.mime || 'image/jpeg', jpegThumbnail: buf.length > 1024 * 1024 ? null : buf };
        else if (cached.type === 'video') wrap.message.videoMessage = { mimetype: cached.mime || 'video/mp4', jpegThumbnail: buf.length > 1024 * 1024 ? null : buf };
        else if (cached.type === 'audio') wrap.message.audioMessage = { mimetype: cached.mime || 'audio/mp4' };
        else if (cached.type === 'sticker') wrap.message.stickerMessage = { mimetype: cached.mime || 'image/webp' };
        else if (cached.type === 'document') wrap.message.documentMessage = { mimetype: cached.mime || 'application/octet-stream', fileName: cached.fileName || 'arquivo' };
        else if (cached.text) wrap.message.conversation = cached.text;
        return { quoted: wrap, cached };
    }
    return { quoted: null, cached: null };
}

async function sendReply(payload) {
    if (!sockRef) return { ok: false, error: 'Bot não conectado' };
    const { toJid, text, quotedId, quotedParticipant, quotedFromMe, media } = payload || {};
    if (!toJid) return { ok: false, error: 'Dados incompletos' };

    let quotedMessage = null;
    let cachedMedia = null;
    if (quotedId) {
        const r = await buildQuotedPayload(quotedId, quotedParticipant);
        quotedMessage = r.quoted;
        cachedMedia = r.cached;
    }

    const baseOpts = {};
    if (quotedMessage) {
        baseOpts.quoted = {
            key: { remoteJid: toJid, id: quotedId, participant: quotedParticipant || undefined, fromMe: !!quotedFromMe },
            message: quotedMessage.message
        };
    }

    // Sem texto e sem mídia = erro
    const hasText = !!(text && String(text).trim().length > 0);
    const hasMedia = !!(media && media.dataBase64 && media.type);
    if (!hasText && !hasMedia) return { ok: false, error: 'Mensagem vazia' };

    let sent;
    if (hasMedia) {
        const buf = Buffer.from(media.dataBase64, 'base64');
        const m = { ...baseOpts.quoted && { quoted: baseOpts.quoted } };
        const caption = hasText ? String(text).slice(0, 1024) : undefined;
        if (media.type === 'image') {
            sent = await sockRef.sendMessage(toJid, { image: buf, mimetype: media.mime || 'image/jpeg', caption }, m);
        } else if (media.type === 'video') {
            sent = await sockRef.sendMessage(toJid, { video: buf, mimetype: media.mime || 'video/mp4', caption, gifPlayback: !!media.gif }, m);
        } else if (media.type === 'audio') {
            sent = await sockRef.sendMessage(toJid, { audio: buf, mimetype: media.mime || 'audio/mp4', ptt: !!media.ptt }, m);
        } else if (media.type === 'sticker') {
            sent = await sockRef.sendMessage(toJid, { sticker: buf, mimetype: media.mime || 'image/webp' }, m);
        } else if (media.type === 'document') {
            sent = await sockRef.sendMessage(toJid, { document: buf, mimetype: media.mime || 'application/octet-stream', fileName: media.fileName || 'arquivo', caption }, m);
        } else {
            return { ok: false, error: 'Tipo de mídia não suportado' };
        }
    } else {
        sent = await sockRef.sendMessage(toJid, { text: String(text).slice(0, 4096) }, baseOpts);
    }

    log('action', await getGroupName(toJid),
        hasMedia ? `📤 Mídia${hasText ? ' + texto' : ''} via dashboard` : `📤 Resposta via dashboard: ${text}`,
        'Você', sockRef.user?.id?.split(':')[0] || 'bot', null,
        { toJid, messageId: sent?.key?.id, senderJid: sockRef.user?.id, fromMe: true });

    return { ok: true, messageId: sent?.key?.id };
}

async function sendDirect(payload) {
    if (!sockRef) return { ok: false, error: 'Bot não conectado' };
    const { toJid, text, media } = payload || {};
    if (!toJid) return { ok: false, error: 'Dados incompletos' };
    const hasText = !!(text && String(text).trim().length > 0);
    const hasMedia = !!(media && media.dataBase64 && media.type);
    if (!hasText && !hasMedia) return { ok: false, error: 'Mensagem vazia' };

    let sent;
    if (hasMedia) {
        const buf = Buffer.from(media.dataBase64, 'base64');
        const caption = hasText ? String(text).slice(0, 1024) : undefined;
        if (media.type === 'image') sent = await sockRef.sendMessage(toJid, { image: buf, mimetype: media.mime || 'image/jpeg', caption });
        else if (media.type === 'video') sent = await sockRef.sendMessage(toJid, { video: buf, mimetype: media.mime || 'video/mp4', caption, gifPlayback: !!media.gif });
        else if (media.type === 'audio') sent = await sockRef.sendMessage(toJid, { audio: buf, mimetype: media.mime || 'audio/mp4', ptt: !!media.ptt });
        else if (media.type === 'sticker') sent = await sockRef.sendMessage(toJid, { sticker: buf, mimetype: media.mime || 'image/webp' });
        else if (media.type === 'document') sent = await sockRef.sendMessage(toJid, { document: buf, mimetype: media.mime || 'application/octet-stream', fileName: media.fileName || 'arquivo', caption });
        else return { ok: false, error: 'Tipo não suportado' };
    } else {
        sent = await sockRef.sendMessage(toJid, { text: String(text).slice(0, 4096) });
    }
    return { ok: true, messageId: sent?.key?.id };
}

async function getGroupName(jid) {
    if (!sockRef || !jid?.endsWith('@g.us')) return jid;
    try { return (await sockRef.groupMetadata(jid))?.subject || jid; } catch (_) { return jid; }
}

function log(type, group, text, name = null, phone = null, media = null, extra = {}) {
    const logData = {
        type,
        group: group || 'Sistema',
        text,
        name,
        phone,
        media,
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toJid: extra.toJid || null,
        messageId: extra.messageId || null,
        quoted: extra.quoted || null,
        hidden: !!extra.hidden,
        ephemeral: !!extra.ephemeral,
        senderJid: extra.senderJid || null,
        fromMe: !!extra.fromMe
    };

    dashboardLogs.push(logData);
    if (dashboardLogs.length > MAX_LOGS) dashboardLogs.shift();
    if (ioServer) ioServer.emit('msg', logData);
}

function getHtml(botName) {
    return `
<!DOCTYPE html>
<html lang="pt-br">
<head>
    <title>${botName} Monitor</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#0b141a">
    <style>
        :root {
            --wa-green: #25d366;
            --wa-green-dark: #075e54;
            --wa-green-light: #128c7e;
            --wa-bg-light: #efeae2;
            --wa-bg-dark: #0b141a;
            --wa-bg-oled: #000000;
            --msg-in-light: #ffffff;
            --msg-in-dark: #202c33;
            --msg-out-light: #d9fdd3;
            --msg-out-dark: #005c4b;
            --text-primary-light: #111b21;
            --text-primary-dark: #e9edef;
            --text-secondary-light: #667781;
            --text-secondary-dark: #8696a0;
            --header-light: #f0f2f5;
            --header-dark: #202c33;
            --quote-bg: rgba(11,97,79,0.15);
            --hidden-bg: rgba(255,165,0,0.18);
        }

        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { height: 100%; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            display: flex; flex-direction: column;
            transition: background-color 0.3s, color 0.3s;
            overflow: hidden; position: fixed; width: 100%;
            padding-top: env(safe-area-inset-top);
            padding-bottom: env(safe-area-inset-bottom);
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
        }

        body.light { background-color: var(--wa-bg-light); color: var(--text-primary-light); }
        body.dark { background-color: var(--wa-bg-dark); color: var(--text-primary-dark); }
        body.oled { background-color: var(--wa-bg-oled); color: var(--text-primary-dark); }

        body.light #header { background-color: var(--header-light); }
        body.dark #header, body.oled #header { background-color: var(--header-dark); }

        body.light .msg { background-color: var(--msg-in-light); color: var(--text-primary-light); }
        body.dark .msg, body.oled .msg { background-color: var(--msg-in-dark); color: var(--text-primary-dark); }

        .wallpaper {
            position: fixed; inset: 0;
            background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png');
            background-repeat: repeat; opacity: 0.06; pointer-events: none; z-index: 0;
        }
        body.oled .wallpaper { opacity: 0.02; }

        #header {
            padding: 8px 12px;
            display: flex; align-items: center; gap: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            z-index: 10; height: 60px; flex-shrink: 0;
        }
        #header img { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--wa-green); flex-shrink: 0; }
        #header-info { flex: 1; min-width: 0; }
        #header-info div:first-child { font-weight: bold; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #header-info div:last-child { font-size: 11px; color: var(--wa-green); font-weight: 500; }

        .theme-selector { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
        .theme-btn {
            border: none; padding: 5px 8px; border-radius: 15px; cursor: pointer; font-size: 10px; font-weight: bold;
            transition: transform 0.1s; text-transform: uppercase;
        }
        .theme-btn:active { transform: scale(0.95); }
        .btn-light { background: #fff; color: #000; border: 1px solid #ddd; }
        .btn-dark { background: #202c33; color: #fff; }
        .btn-oled { background: #000; color: #fff; border: 1px solid #333; }

        #chat {
            flex: 1; overflow-y: auto;
            padding: 12px 8px 8px;
            display: flex; flex-direction: column; gap: 6px;
            scroll-behavior: smooth; z-index: 1;
            -webkit-overflow-scrolling: touch;
        }
        @media (min-width: 700px) { #chat { padding: 15px 10% 12px; } }

        .msg-wrapper { display: flex; flex-direction: column; width: 100%; margin-bottom: 2px; }
        .msg {
            max-width: 85%;
            padding: 6px 10px 5px;
            border-radius: 10px;
            font-size: 14.5px;
            position: relative;
            box-shadow: 0 1px 1px rgba(0,0,0,0.12);
            animation: fadeIn 0.2s ease-out;
            line-height: 1.4;
            cursor: pointer;
            -webkit-user-select: none; user-select: none;
        }
        .msg:active { transform: scale(0.99); }
        @media (max-width: 480px) { .msg { max-width: 92%; font-size: 14px; } }

        .msg.received { align-self: flex-start; border-top-left-radius: 0; }

        .msg.system-error { background-color: #ffdce0 !important; color: #86181d !important; align-self: center; border-radius: 8px; border: 1px solid #f1aeb5; max-width: 95%; font-size: 13px; text-align: center; }
        body.dark .msg.system-error, body.oled .msg.system-error { background-color: #442726 !important; color: #ff8182 !important; border-color: #603030; }

        .msg.bot-action { background-color: #e7f3ff !important; color: #004085 !important; align-self: center; border-radius: 8px; border: 1px solid #b8daff; max-width: 95%; font-size: 13px; text-align: center; }
        body.dark .msg.bot-action, body.oled .msg.bot-action { background-color: #1a2733 !important; color: #7abaff !important; border-color: #2b4560; }

        .msg.member-event { background-color: #d4edda !important; color: #155724 !important; align-self: center; border-radius: 8px; border: 1px solid #c3e6cb; max-width: 95%; font-size: 12px; text-align: center; }
        body.dark .msg.member-event, body.oled .msg.member-event { background-color: #1b2e21 !important; color: #72cf8a !important; border-color: #2b4f35; }

        .msg.hidden { border: 1.5px dashed #ff9f43 !important; }
        .msg.viewonce { border: 1.5px dashed #ff9f43 !important; }
        .hidden-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 4px; background: var(--hidden-bg); color: #ff9f43; margin-bottom: 3px; }

        .sender-info { display: flex; gap: 6px; align-items: baseline; margin-bottom: 2px; flex-wrap: wrap; }
        .sender { font-size: 12.5px; font-weight: 700; }
        .phone { font-size: 10.5px; opacity: 0.6; }
        .group-name { font-size: 10.5px; font-weight: bold; padding: 1px 5px; border-radius: 8px; background: rgba(0,0,0,0.05); }
        body.dark .group-name, body.oled .group-name { background: rgba(255,255,255,0.1); }

        .type-tag { font-size: 9px; text-transform: uppercase; padding: 1px 4px; border-radius: 3px; font-weight: 900; letter-spacing: 0.4px; }

        .text { word-wrap: break-word; white-space: pre-wrap; margin-top: 2px; }

        .quoted-preview {
            border-left: 3px solid var(--wa-green);
            padding: 5px 8px;
            margin: 4px 0 6px;
            background: var(--quote-bg);
            border-radius: 4px;
            font-size: 12.5px;
            opacity: 0.95;
        }
        .quoted-preview .qname { font-weight: bold; font-size: 11.5px; }
        .quoted-preview .qtext { white-space: pre-wrap; word-break: break-word; }
        .quoted-preview .qmedia { font-style: italic; opacity: 0.8; font-size: 11.5px; }

        .media-container { margin-top: 5px; border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.1); display: flex; justify-content: center; }
        .media-container img, .media-container video { max-width: 100%; max-height: 300px; display: block; }
        .media-container audio { width: 100%; height: 35px; margin-top: 5px; }

        .time-wrapper { display: flex; justify-content: flex-end; align-items: center; gap: 4px; margin-top: 2px; }
        .time { font-size: 10px; opacity: 0.5; }

        .date-divider {
            align-self: center; background: #e1f3fb; padding: 5px 12px; border-radius: 8px;
            font-size: 11.5px; color: #54656f; margin: 12px 0; text-transform: uppercase;
            box-shadow: 0 1px 1px rgba(0,0,0,0.08); font-weight: 500;
        }
        body.dark .date-divider, body.oled .date-divider { background: #182229; color: #8696a0; }

        @keyframes fadeIn { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(134, 150, 160, 0.3); border-radius: 10px; }

        /* Composer estilo WhatsApp */
        #composer {
            position: relative;
            z-index: 5;
            display: flex; flex-direction: column;
            padding: 6px 8px calc(8px + env(safe-area-inset-bottom));
            background: transparent;
            flex-shrink: 0;
        }
        body.light #composer { background: var(--header-light); }
        body.dark #composer, body.oled #composer { background: var(--header-dark); }

        #composer .reply-bar {
            display: none;
            align-items: center; gap: 8px;
            padding: 6px 10px;
            margin-bottom: 6px;
            border-radius: 10px;
            background: var(--quote-bg);
            border-left: 3px solid var(--wa-green);
            font-size: 12.5px;
            position: relative;
        }
        #composer .reply-bar.show { display: flex; }
        #composer .reply-bar .rb-info { flex: 1; min-width: 0; }
        #composer .reply-bar .rb-name { font-weight: bold; font-size: 12px; }
        #composer .reply-bar .rb-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.85; }
        #composer .reply-bar .rb-close {
            border: none; background: transparent; color: inherit; cursor: pointer;
            font-size: 18px; width: 28px; height: 28px; border-radius: 50%;
        }
        #composer .reply-bar .rb-close:active { background: rgba(127,127,127,0.2); }

        #composer .attachments {
            display: none;
            gap: 6px; padding: 0 6px 6px;
            overflow-x: auto;
        }
        #composer .attachments.show { display: flex; }
        #composer .attachments .att {
            position: relative;
            border-radius: 8px; overflow: hidden;
            background: rgba(127,127,127,0.15);
            height: 80px; min-width: 80px; max-width: 120px;
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0;
        }
        #composer .attachments .att img,
        #composer .attachments .att video { max-height: 100%; max-width: 100%; display: block; }
        #composer .attachments .att .att-info {
            font-size: 11px; padding: 4px; text-align: center; line-height: 1.2;
        }
        #composer .attachments .att .att-close {
            position: absolute; top: 2px; right: 2px;
            width: 22px; height: 22px; border-radius: 50%;
            border: none; background: rgba(0,0,0,0.6); color: #fff;
            font-size: 14px; cursor: pointer;
        }

        #composer .input-row {
            display: flex; align-items: flex-end; gap: 6px;
        }
        #composer .icon-btn {
            width: 42px; height: 42px; border-radius: 50%;
            border: none; background: transparent; color: var(--text-secondary-dark);
            font-size: 22px; cursor: pointer; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
        }
        body.light #composer .icon-btn { color: var(--text-secondary-light); }
        #composer .icon-btn:active { background: rgba(127,127,127,0.2); }

        #composer .input-wrap {
            flex: 1; min-width: 0;
            background: rgba(127,127,127,0.18);
            border-radius: 22px;
            padding: 6px 10px;
            display: flex; align-items: flex-end; gap: 6px;
            min-height: 42px;
        }
        body.light #composer .input-wrap { background: #fff; }
        #composer textarea {
            flex: 1; min-width: 0;
            border: none; outline: none; background: transparent; color: inherit;
            font: inherit; font-size: 15px; resize: none;
            max-height: 120px; line-height: 1.35;
            padding: 6px 2px;
        }

        #composer .send-btn {
            width: 46px; height: 42px; border-radius: 50%;
            border: none; background: var(--wa-green); color: #fff;
            font-size: 20px; cursor: pointer; flex-shrink: 0;
            display: flex; align-items: center; justify-content: center;
            transition: transform 0.1s, background 0.2s;
        }
        #composer .send-btn:active { transform: scale(0.92); background: var(--wa-green-dark); }
        #composer .send-btn:disabled { opacity: 0.5; }

        .toast {
            position: fixed; left: 50%; bottom: calc(80px + env(safe-area-inset-bottom));
            transform: translateX(-50%); background: rgba(0,0,0,0.85); color: #fff;
            padding: 8px 14px; border-radius: 20px; font-size: 13px; z-index: 200;
            opacity: 0; pointer-events: none; transition: opacity 0.2s;
        }
        .toast.show { opacity: 1; }
    </style>
</head>
<body class="dark">
    <div class="wallpaper"></div>
    <div id="header">
        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(botName)}&background=128c7e&color=fff" id="bot-logo">
        <div id="header-info">
            <div>${botName}</div>
            <div id="status">Conectando...</div>
        </div>
        <div class="theme-selector">
            <button id="notif-btn" class="theme-btn" style="background: var(--wa-green-light); color: white;" onclick="toggleSound()">SOM</button>
            <button id="push-btn" class="theme-btn" style="background: #3498db; color: white;" onclick="togglePush()">PUSH</button>
            <button class="theme-btn btn-light" onclick="setTheme('light')">☀</button>
            <button class="theme-btn btn-dark" onclick="setTheme('dark')">🌙</button>
            <button class="theme-btn btn-oled" onclick="setTheme('oled')">⬛</button>
        </div>
    </div>
    <div id="chat"></div>

    <div id="composer">
        <div class="reply-bar" id="replyBar">
            <div class="rb-info">
                <div class="rb-name" id="replyName"></div>
                <div class="rb-text" id="replyText"></div>
            </div>
            <button class="rb-close" onclick="clearReply()">✕</button>
        </div>
        <div class="attachments" id="attachments"></div>
        <div class="input-row">
            <button class="icon-btn" id="attachBtn" title="Anexar mídia">＋</button>
            <input type="file" id="fileInput" multiple style="display:none" accept="image/*,video/*,audio/*,application/*">
            <div class="input-wrap">
                <textarea id="messageInput" placeholder="Mensagem" rows="1"></textarea>
            </div>
            <button class="send-btn" id="sendBtn" onclick="sendCurrent()">➤</button>
        </div>
    </div>

    <div class="toast" id="toast"></div>

    <audio id="sound-chat" src="https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3" preload="auto"></audio>
    <audio id="sound-action" src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" preload="auto"></audio>
    <audio id="sound-error" src="https://assets.mixkit.co/active_storage/sfx/2955/2955-preview.mp3" preload="auto"></audio>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const chat = document.getElementById('chat');
        const soundChat = document.getElementById('sound-chat');
        const soundAction = document.getElementById('sound-action');
        const soundError = document.getElementById('sound-error');
        const notifBtn = document.getElementById('notif-btn');
        const pushBtn = document.getElementById('push-btn');
        const replyBar = document.getElementById('replyBar');
        const replyName = document.getElementById('replyName');
        const replyTextEl = document.getElementById('replyText');
        const attachmentsEl = document.getElementById('attachments');
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const attachBtn = document.getElementById('attachBtn');
        const fileInput = document.getElementById('fileInput');
        const toastEl = document.getElementById('toast');

        let lastDate = "";
        let soundEnabled = false;
        let pushEnabled = false;
        let currentReply = null; // { toJid, messageId, senderJid, fromMe, name, preview }
        let pendingAttachments = []; // [{ dataBase64, type, mime, fileName, previewUrl }]

        function playSound(audio) {
            if (!soundEnabled) return;
            try { audio.currentTime = 0; const p = audio.play(); if (p && p.then) p.catch(() => {}); } catch (e) {}
        }
        function showToast(msg, ms = 2000) {
            toastEl.textContent = msg;
            toastEl.classList.add('show');
            clearTimeout(showToast._t);
            showToast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
        }
        function toggleSound() {
            soundEnabled = !soundEnabled;
            notifBtn.innerText = soundEnabled ? 'SOM ON' : 'SOM';
            notifBtn.style.background = soundEnabled ? 'var(--wa-green)' : 'var(--wa-green-light)';
            if (soundEnabled) playSound(soundChat);
            localStorage.setItem('wa_sound', soundEnabled ? '1' : '0');
        }
        function togglePush() {
            if (!pushEnabled) {
                if (!("Notification" in window)) { alert("Sem suporte a notificações."); return; }
                Notification.requestPermission().then(p => {
                    if (p === "granted") { pushEnabled = true; pushBtn.innerText = "PUSH ON"; pushBtn.style.background = "#2980b9"; }
                });
            } else { pushEnabled = false; pushBtn.innerText = "PUSH"; pushBtn.style.background = "#3498db"; }
            localStorage.setItem('wa_push', pushEnabled ? '1' : '0');
        }
        function setTheme(t) { document.body.className = t; localStorage.setItem('wa_theme', t); }
        const savedTheme = localStorage.getItem('wa_theme') || 'dark';
        setTheme(savedTheme);
        soundEnabled = localStorage.getItem('wa_sound') === '1';
        if (soundEnabled) { notifBtn.innerText = 'SOM ON'; notifBtn.style.background = 'var(--wa-green)'; }

        function scrollToBottom() { setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 50); }
        function getUserColor(phone) {
            if (!phone) return '#53bdeb';
            const colors = ['#3498db','#e74c3c','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#d35400','#c0392b','#27ae60','#2980b9','#8e44ad','#f39c12','#16a085','#7f8c8d'];
            let hash = 0;
            for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
            return colors[Math.abs(hash) % colors.length];
        }
        function escapeHtml(s) {
            return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
        }

        function detectMediaType(file) {
            const t = (file.type || '').toLowerCase();
            if (t === 'image/webp') return 'sticker';
            if (t.startsWith('image/')) return 'image';
            if (t.startsWith('video/')) return 'video';
            if (t.startsWith('audio/')) return 'audio';
            return 'document';
        }

        function fileToDataUrl(file) {
            return new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = reject;
                r.readAsDataURL(file);
            });
        }

        function renderAttachments() {
            attachmentsEl.innerHTML = '';
            if (pendingAttachments.length === 0) {
                attachmentsEl.classList.remove('show');
                return;
            }
            attachmentsEl.classList.add('show');
            pendingAttachments.forEach((att, i) => {
                const div = document.createElement('div');
                div.className = 'att';
                if (att.type === 'image' || att.type === 'sticker') {
                    div.innerHTML = \`<img src="\${att.previewUrl}"><button class="att-close" data-i="\${i}">✕</button>\`;
                } else if (att.type === 'video') {
                    div.innerHTML = \`<video src="\${att.previewUrl}" muted></video><button class="att-close" data-i="\${i}">✕</button>\`;
                } else if (att.type === 'audio') {
                    div.innerHTML = \`<div class="att-info">🎵 \${escapeHtml(att.fileName)}</div><button class="att-close" data-i="\${i}">✕</button>\`;
                } else {
                    div.innerHTML = \`<div class="att-info">📎 \${escapeHtml(att.fileName)}</div><button class="att-close" data-i="\${i}">✕</button>\`;
                }
                attachmentsEl.appendChild(div);
            });
            attachmentsEl.querySelectorAll('.att-close').forEach(btn => {
                btn.onclick = () => { pendingAttachments.splice(parseInt(btn.dataset.i, 10), 1); renderAttachments(); };
            });
        }

        attachBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files || []);
            fileInput.value = '';
            for (const f of files) {
                if (f.size > 16 * 1024 * 1024) { showToast('Arquivo > 16MB'); continue; }
                const type = detectMediaType(f);
                const dataUrl = await fileToDataUrl(f);
                const base64 = dataUrl.split(',')[1];
                pendingAttachments.push({ dataBase64: base64, type, mime: f.type, fileName: f.name, previewUrl: dataUrl });
            }
            renderAttachments();
        });

        function autoSize() {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
        }
        messageInput.addEventListener('input', autoSize);

        function setReply(target) {
            currentReply = target;
            if (!target) {
                replyBar.classList.remove('show');
                return;
            }
            replyName.textContent = target.name || (target.phone ? '@' + target.phone : 'Mensagem');
            replyTextEl.textContent = target.preview || (target.hasMedia ? '📎 Mídia' : '');
            replyBar.classList.add('show');
        }
        function clearReply() { currentReply = null; replyBar.classList.remove('show'); }

        async function sendCurrent() {
            const text = messageInput.value.trim();
            const hasText = text.length > 0;
            const hasMedia = pendingAttachments.length > 0;
            if (!hasText && !hasMedia) { showToast('Digite ou anexe algo'); return; }
            if (!currentReply && pendingAttachments.length === 0 && !text) return;

            // Se há reply: usa /api/reply (que faz a hidratação). Senão /api/send.
            sendBtn.disabled = true;

            try {
                let url = '/api/send';
                let body = {};

                if (currentReply) {
                    url = '/api/reply';
                    body = {
                        toJid: currentReply.toJid,
                        text: hasText ? text : '',
                        quotedId: currentReply.messageId,
                        quotedParticipant: currentReply.senderJid,
                        quotedFromMe: currentReply.fromMe
                    };
                    if (hasMedia) body.media = pendingAttachments[0]; // 1 mídia por reply
                } else {
                    url = '/api/send';
                    body = { toJid: pendingTargetJid || '', text: hasText ? text : '' };
                    if (pendingTargetJid) {
                        if (hasMedia) body.media = pendingAttachments[0];
                    } else {
                        // Sem destino: exige uma mensagem selecionada (reply) ou destino conhecido
                        showToast('Selecione uma mensagem para responder');
                        sendBtn.disabled = false;
                        return;
                    }
                }

                const r = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const j = await r.json();
                if (j.ok) {
                    showToast('✅ Enviado');
                    messageInput.value = '';
                    autoSize();
                    pendingAttachments = [];
                    renderAttachments();
                    clearReply();
                } else {
                    showToast('❌ ' + (j.error || 'falha'));
                }
            } catch (e) {
                showToast('❌ ' + e.message);
            } finally {
                sendBtn.disabled = false;
            }
        }

        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
        });

        let pendingTargetJid = null;

        function quotedHtml(q) {
            if (!q) return '';
            const name = escapeHtml(q.name || (q.phone ? '@' + q.phone : 'Mensagem'));
            let inner;
            if (q.text) inner = \`<div class="qtext">\${escapeHtml(q.text)}</div>\`;
            else if (q.hasMedia) inner = \`<div class="qmedia">📎 Mídia</div>\`;
            else inner = '';
            return \`<div class="quoted-preview"><div class="qname">\${name}</div>\${inner}</div>\`;
        }
        function mediaHtml(media) {
            if (!media) return '';
            if (media.type === 'image') return \`<div class="media-container"><img src="\${escapeHtml(media.url)}"></div>\`;
            if (media.type === 'video') return \`<div class="media-container"><video src="\${escapeHtml(media.url)}" controls></video></div>\`;
            if (media.type === 'audio') return \`<div class="media-container"><audio src="\${escapeHtml(media.url)}" controls></audio></div>\`;
            if (media.type === 'sticker') return \`<div class="media-container"><img src="\${escapeHtml(media.url)}" style="width:120px;height:120px;background:none;"></div>\`;
            return '';
        }

        function appendMessage(data, isNew = true) {
            const dateStr = new Date(data.timestamp || Date.now()).toLocaleDateString();
            if (dateStr !== lastDate) {
                const d = document.createElement('div');
                d.className = 'date-divider';
                d.innerText = dateStr === new Date().toLocaleDateString() ? "Hoje" : dateStr;
                chat.appendChild(d);
                lastDate = dateStr;
            }
            const wrapper = document.createElement('div');
            wrapper.className = 'msg-wrapper';

            let msgClass = "received";
            let typeTag = "";
            if (data.type === 'error') { msgClass = "system-error"; typeTag = '<span class="type-tag">ERRO</span>'; }
            else if (data.type === 'action') { msgClass = "bot-action"; typeTag = '<span class="type-tag">AÇÃO</span>'; }
            else if (data.type === 'event') { msgClass = "member-event"; typeTag = ''; }
            else if (data.type === 'viewonce') { msgClass = "viewonce"; typeTag = '<span class="type-tag" style="background:rgba(255,165,0,0.25);color:#ff9f43;">VIEWONCE</span>'; }

            const userColor = getUserColor(data.phone);
            const inner = document.createElement('div');
            inner.className = 'msg ' + msgClass + (data.hidden ? ' hidden' : '');
            inner.dataset.toJid = data.toJid || '';
            inner.dataset.messageId = data.messageId || '';
            inner.dataset.senderJid = data.senderJid || '';
            inner.dataset.fromMe = data.fromMe ? '1' : '0';
            inner.dataset.group = data.group || '';
            inner.dataset.phone = data.phone || '';
            inner.dataset.name = data.name || '';
            inner.dataset.preview = data.text || '';
            inner.dataset.hasMedia = data.media ? '1' : '0';

            let html = '';
            if (data.hidden || data.type === 'viewonce') {
                html += '<div class="hidden-badge">👁️‍🗨️ ' + (data.type === 'viewonce' ? 'MÍDIA REVELADA' : 'MENSAGEM OCULTA') + '</div>';
            }
            if (data.type === 'chat' || data.type === 'viewonce') {
                html += \`<div class="sender-info">
                    <span class="sender" style="color: \${userColor}">\${escapeHtml(data.name || 'Usuário')}</span>
                    <span class="phone">\${data.phone ? '@' + escapeHtml(data.phone) : ''}</span>
                    <span class="group-name">\${escapeHtml(data.group || 'Grupo')}</span>
                </div>\`;
            } else {
                html += \`<div class="sender-info">
                    \${typeTag}
                    <span class="group-name">\${escapeHtml(data.group || 'Sistema')}</span>
                </div>\`;
            }
            if (data.quoted) html += quotedHtml(data.quoted);
            html += mediaHtml(data.media);
            if (data.text) html += \`<div class="text">\${escapeHtml(data.text)}</div>\`;
            html += \`<div class="time-wrapper"><div class="time">\${escapeHtml(data.time || new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}))}</div></div>\`;
            inner.innerHTML = html;
            inner.addEventListener('click', () => openReplyFor(inner));
            wrapper.appendChild(inner);
            chat.appendChild(wrapper);

            if (isNew) {
                scrollToBottom();
                if (data.type === 'chat') playSound(soundChat);
                else if (data.type === 'action' || data.type === 'viewonce') playSound(soundAction);
                else if (data.type === 'error') playSound(soundError);

                if (pushEnabled && document.visibilityState !== 'visible') {
                    let title = data.name ? \`\${data.name} (@\${data.phone})\` : (data.group || 'Nova mensagem');
                    let body = (data.hidden || data.type === 'viewonce' ? '🔒 ' : '') + (data.text || (data.media ? 'Mídia' : 'Nova mensagem'));
                    try { new Notification(title, { body, icon: 'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.name || 'U') + '&background=25d366&color=fff' }); } catch (_) {}
                }
            }
        }

        function openReplyFor(el) {
            const toJid = el.dataset.toJid;
            const messageId = el.dataset.messageId;
            if (!toJid) {
                showToast('Sem identificação de destino');
                pendingTargetJid = null;
                return;
            }
            pendingTargetJid = toJid;
            const target = {
                toJid,
                messageId,
                senderJid: el.dataset.senderJid || undefined,
                fromMe: el.dataset.fromMe === '1',
                group: el.dataset.group,
                phone: el.dataset.phone,
                name: el.dataset.name,
                preview: el.dataset.preview || (el.dataset.hasMedia === '1' ? '📎 Mídia' : ''),
                hasMedia: el.dataset.hasMedia === '1'
            };
            setReply(target);
            messageInput.focus();
        }

        socket.on('history', (history) => { chat.innerHTML = ''; lastDate = ""; history.forEach(d => appendMessage(d, false)); scrollToBottom(); });
        socket.on('msg', (data) => appendMessage(data));
        socket.on('connect', () => { document.getElementById('status').innerText = 'Online'; document.getElementById('status').style.color = 'var(--wa-green)'; });
        socket.on('disconnect', () => { document.getElementById('status').innerText = 'Reconectando...'; document.getElementById('status').style.color = '#ff8182'; });
    </script>
</body>
</html>
    `;
}

module.exports = { init, log, attachSock, cacheMedia };