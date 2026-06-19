const http = require('http');
const { Server } = require('socket.io');

let ioServer = null;
let sockRef = null;
const dashboardLogs = []; // In-memory storage (RAM)
const MAX_LOGS = 500;

function attachSock(sock) {
    sockRef = sock;
}

function init(config) {
    if (config.dashboardEnabled === false) return null;

    const port = config.dashboardPort || 3000;

    const server = http.createServer(async (req, res) => {
        // CORS simples para o fetch do front
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        if (req.method === 'POST' && req.url === '/api/reply') {
            let body = '';
            req.on('data', chunk => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const result = await sendReply(payload);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        if (req.method === 'POST' && req.url === '/api/send') {
            let body = '';
            req.on('data', chunk => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
            req.on('end', async () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const result = await sendDirect(payload);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: e.message }));
                }
            });
            return;
        }

        if (req.method === 'GET' && req.url === '/api/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: !!sockRef, connected: !!sockRef }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHtml(config.botName));
    });

    ioServer = new Server(server);

    ioServer.on('connection', (socket) => {
        socket.emit('history', dashboardLogs);
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`📊 Dashboard ativo em: http://localhost:${port}`);
    });

    return ioServer;
}

async function sendReply(payload) {
    if (!sockRef) return { ok: false, error: 'Bot não conectado' };
    const { toJid, text, quotedId, quotedParticipant, quotedFromMe } = payload || {};
    if (!toJid || !text) return { ok: false, error: 'Dados incompletos' };

    const messageContent = { text: String(text).slice(0, 4096) };
    const options = {};
    if (quotedId) {
        options.quoted = {
            key: {
                remoteJid: toJid,
                id: quotedId,
                participant: quotedParticipant || undefined,
                fromMe: !!quotedFromMe
            },
            message: { conversation: '‎' }
        };
    }
    const sent = await sockRef.sendMessage(toJid, messageContent, options);
    log('action', await getGroupName(toJid), `📤 Resposta via dashboard: ${text}`, 'Você', sockRef.user?.id?.split(':')[0] || 'bot', null, { toJid, messageId: sent?.key?.id });
    return { ok: true, messageId: sent?.key?.id };
}

async function sendDirect(payload) {
    if (!sockRef) return { ok: false, error: 'Bot não conectado' };
    const { toJid, text } = payload || {};
    if (!toJid || !text) return { ok: false, error: 'Dados incompletos' };
    const sent = await sockRef.sendMessage(toJid, { text: String(text).slice(0, 4096) });
    return { ok: true, messageId: sent?.key?.id };
}

async function getGroupName(jid) {
    if (!sockRef || !jid?.endsWith('@g.us')) return jid;
    try {
        const meta = await sockRef.groupMetadata(jid);
        return meta?.subject || jid;
    } catch (_) {
        return jid;
    }
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
        // extras
        toJid: extra.toJid || null,
        messageId: extra.messageId || null,
        quoted: extra.quoted || null,            // dados da mensagem citada (texto, sender, mid)
        hidden: !!extra.hidden,                  // viewOnce/efêmera
        ephemeral: !!extra.ephemeral,
        senderJid: extra.senderJid || null,
        fromMe: !!extra.fromMe
    };

    dashboardLogs.push(logData);
    if (dashboardLogs.length > MAX_LOGS) dashboardLogs.shift();

    if (ioServer) {
        ioServer.emit('msg', logData);
    }
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
            display: flex;
            flex-direction: column;
            transition: background-color 0.3s, color 0.3s;
            overflow: hidden;
            position: fixed;
            width: 100%;
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
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png');
            background-repeat: repeat; opacity: 0.06; pointer-events: none; z-index: 0;
        }
        body.oled .wallpaper { opacity: 0.02; }

        #header {
            padding: 8px 12px;
            display: flex; align-items: center; gap: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            z-index: 10; height: 60px;
            flex-shrink: 0;
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
            padding: 15px 10%;
            display: flex; flex-direction: column; gap: 6px;
            scroll-behavior: smooth; z-index: 1;
            -webkit-overflow-scrolling: touch;
        }
        @media (max-width: 768px) { #chat { padding: 10px 8px; } }

        .msg-wrapper { display: flex; flex-direction: column; width: 100%; margin-bottom: 2px; }
        .msg {
            max-width: 85%;
            padding: 6px 10px 5px 10px;
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
        .hidden-badge { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: bold; padding: 1px 6px; border-radius: 4px; background: var(--hidden-bg); color: #ff9f43; margin-bottom: 3px; }

        .sender-info { display: flex; gap: 6px; align-items: baseline; margin-bottom: 2px; flex-wrap: wrap; }
        .sender { font-size: 12.5px; font-weight: 700; }
        .phone { font-size: 10.5px; opacity: 0.6; }
        .group-name {
            font-size: 10.5px; font-weight: bold; padding: 1px 5px; border-radius: 8px;
            background: rgba(0,0,0,0.05); white-space: nowrap;
        }
        body.dark .group-name, body.oled .group-name { background: rgba(255,255,255,0.1); }

        .type-tag { font-size: 9px; text-transform: uppercase; padding: 1px 4px; border-radius: 3px; font-weight: 900; letter-spacing: 0.4px; }

        .text { word-wrap: break-word; white-space: pre-wrap; margin-top: 2px; }

        .quoted-preview {
            border-left: 3px solid var(--wa-green);
            padding: 4px 8px;
            margin: 4px 0 6px 0;
            background: var(--quote-bg);
            border-radius: 4px;
            font-size: 12.5px;
            opacity: 0.9;
        }
        .quoted-preview .qname { font-weight: bold; font-size: 11.5px; }
        .quoted-preview .qtext { white-space: pre-wrap; word-break: break-word; }

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

        /* FAB responder */
        .fab {
            position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom));
            width: 56px; height: 56px; border-radius: 50%;
            background: var(--wa-green); color: #fff; border: none;
            box-shadow: 0 6px 16px rgba(0,0,0,0.35);
            display: flex; align-items: center; justify-content: center;
            font-size: 24px; cursor: pointer; z-index: 20;
            transition: transform 0.1s, background 0.2s;
        }
        .fab:active { transform: scale(0.95); background: var(--wa-green-dark); }
        @media (max-width: 480px) { .fab { width: 52px; height: 52px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); } }

        /* Modal de resposta */
        .modal-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.55);
            backdrop-filter: blur(2px);
            z-index: 100;
            display: none;
            align-items: flex-end;
            justify-content: center;
            animation: fadeIn 0.18s ease-out;
        }
        .modal-overlay.show { display: flex; }
        .modal {
            width: 100%; max-width: 600px;
            background: var(--msg-in-dark); color: var(--text-primary-dark);
            border-top-left-radius: 18px; border-top-right-radius: 18px;
            padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
            display: flex; flex-direction: column; gap: 10px;
            max-height: 85vh; overflow: hidden;
            box-shadow: 0 -8px 24px rgba(0,0,0,0.4);
            animation: slideUp 0.22s ease-out;
        }
        @media (min-width: 700px) {
            .modal-overlay { align-items: center; }
            .modal { border-radius: 14px; max-height: 80vh; }
        }
        body.light .modal { background: #ffffff; color: var(--text-primary-light); }

        @keyframes slideUp { from { transform: translateY(40%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

        .modal-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .modal-title { font-weight: bold; font-size: 15px; display: flex; flex-direction: column; gap: 2px; }
        .modal-title small { font-size: 11px; opacity: 0.65; font-weight: 500; }
        .modal-close {
            border: none; background: transparent; color: inherit; font-size: 22px;
            width: 36px; height: 36px; border-radius: 50%; cursor: pointer;
        }
        .modal-close:active { background: rgba(127,127,127,0.18); }

        .modal-target {
            border-left: 3px solid var(--wa-green);
            padding: 6px 10px; background: var(--quote-bg);
            border-radius: 6px; font-size: 12.5px; max-height: 90px; overflow: auto;
        }
        .modal-target .qname { font-weight: bold; font-size: 11.5px; margin-bottom: 2px; }

        .modal textarea {
            width: 100%; min-height: 90px;
            resize: none;
            background: rgba(127,127,127,0.12);
            color: inherit;
            border: 1px solid rgba(127,127,127,0.25);
            border-radius: 10px;
            padding: 10px 12px;
            font: inherit; font-size: 15px;
            outline: none;
        }
        .modal textarea:focus { border-color: var(--wa-green); }

        .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .btn {
            border: none; padding: 10px 16px; border-radius: 22px; cursor: pointer;
            font-size: 14px; font-weight: 600;
        }
        .btn-cancel { background: rgba(127,127,127,0.25); color: inherit; }
        .btn-send { background: var(--wa-green); color: #fff; }
        .btn-send:disabled { opacity: 0.5; }

        /* Toast */
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

    <button class="fab" id="fab" title="Selecionar mensagem para responder">💬</button>

    <div class="modal-overlay" id="replyModal">
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">
                    <span>Responder mensagem</span>
                    <small id="replyTargetLabel"></small>
                </div>
                <button class="modal-close" onclick="closeReplyModal()">✕</button>
            </div>
            <div class="modal-target" id="replyTargetPreview"></div>
            <textarea id="replyText" placeholder="Digite sua resposta..."></textarea>
            <div class="modal-actions">
                <button class="btn btn-cancel" onclick="closeReplyModal()">Cancelar</button>
                <button class="btn btn-send" id="replySendBtn" onclick="sendReply()">Enviar</button>
            </div>
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
        const fab = document.getElementById('fab');
        const modal = document.getElementById('replyModal');
        const replyText = document.getElementById('replyText');
        const replySendBtn = document.getElementById('replySendBtn');
        const replyTargetLabel = document.getElementById('replyTargetLabel');
        const replyTargetPreview = document.getElementById('replyTargetPreview');
        const toastEl = document.getElementById('toast');

        let lastDate = "";
        let soundEnabled = false;
        let pushEnabled = false;
        let currentReplyTarget = null;
        let lastSelectedMsgEl = null;

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
                if (!("Notification" in window)) { alert("Navegador sem suporte a notificações."); return; }
                Notification.requestPermission().then(p => {
                    if (p === "granted") { pushEnabled = true; pushBtn.innerText = "PUSH ON"; pushBtn.style.background = "#2980b9"; }
                });
            } else { pushEnabled = false; pushBtn.innerText = "PUSH"; pushBtn.style.background = "#3498db"; }
            localStorage.setItem('wa_push', pushEnabled ? '1' : '0');
        }
        function setTheme(theme) { document.body.className = theme; localStorage.setItem('wa_theme', theme); }
        const savedTheme = localStorage.getItem('wa_theme') || 'dark';
        setTheme(savedTheme);
        soundEnabled = localStorage.getItem('wa_sound') === '1';
        if (soundEnabled) { notifBtn.innerText = 'SOM ON'; notifBtn.style.background = 'var(--wa-green)'; }

        function scrollToBottom() { setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 100); }
        function getUserColor(phone) {
            if (!phone) return '#53bdeb';
            const colors = ['#3498db','#e74c3c','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#d35400','#c0392b','#27ae60','#2980b9','#8e44ad','#f39c12','#16a085','#7f8c8d'];
            let hash = 0;
            for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
            return colors[Math.abs(hash) % colors.length];
        }

        function escapeHtml(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }

        function quotedHtml(q) {
            if (!q) return '';
            const name = escapeHtml(q.name || (q.phone ? '@' + q.phone : 'Mensagem'));
            const text = q.text ? escapeHtml(q.text) : (q.hasMedia ? '<em>(mídia)</em>' : '');
            return \`<div class="quoted-preview"><div class="qname">\${name}</div><div class="qtext">\${text}</div></div>\`;
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
                const divider = document.createElement('div');
                divider.className = 'date-divider';
                divider.innerText = dateStr === new Date().toLocaleDateString() ? "Hoje" : dateStr;
                chat.appendChild(divider);
                lastDate = dateStr;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'msg-wrapper';

            let msgClass = "received";
            let typeTag = "";
            if (data.type === 'error') { msgClass = "system-error"; typeTag = '<span class="type-tag">ERRO</span>'; }
            else if (data.type === 'action') { msgClass = "bot-action"; typeTag = '<span class="type-tag">AÇÃO</span>'; }
            else if (data.type === 'event') { msgClass = "member-event"; typeTag = ''; }

            const userColor = getUserColor(data.phone);

            // metadata da mensagem para responder
            const meta = {
                toJid: data.toJid || (data.phone ? data.phone + '@s.whatsapp.net' : null),
                messageId: data.messageId || null,
                senderJid: data.senderJid || null,
                fromMe: !!data.fromMe,
                group: data.group
            };

            const inner = document.createElement('div');
            inner.className = 'msg ' + msgClass + (data.hidden ? ' hidden' : '');
            inner.dataset.toJid = meta.toJid || '';
            inner.dataset.messageId = meta.messageId || '';
            inner.dataset.senderJid = meta.senderJid || '';
            inner.dataset.fromMe = meta.fromMe ? '1' : '0';
            inner.dataset.group = data.group || '';
            inner.dataset.phone = data.phone || '';
            inner.dataset.name = data.name || '';

            let html = '';
            if (data.hidden) html += '<div class="hidden-badge">👁️‍🗨️ MENSAGEM OCULTA</div>';

            if (data.type === 'chat') {
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
                else if (data.type === 'action') playSound(soundAction);
                else if (data.type === 'error') playSound(soundError);

                if (pushEnabled && document.visibilityState !== 'visible') {
                    let title, body, iconName, iconBg, tag;
                    if (data.type === 'chat') {
                        title = data.name ? \`\${data.name} (@\${data.phone})\` : (data.group || 'Nova mensagem');
                        body = (data.hidden ? '🔒 ' : '') + (data.text || (data.media ? 'Mídia' : 'Nova mensagem'));
                        iconName = data.name || 'User';
                        iconBg = '25d366';
                        tag = 'chat-' + (data.phone || 'msg');
                    } else if (data.type === 'action') {
                        title = '⚙️ Ação' + (data.group ? ' · ' + data.group : '');
                        body = data.text || 'O bot executou uma ação';
                        iconName = 'Bot'; iconBg = '3498db'; tag = 'action';
                    } else if (data.type === 'error') {
                        title = '❌ Erro' + (data.group ? ' · ' + data.group : '');
                        body = data.text || 'Erro';
                        iconName = '!'; iconBg = 'e74c3c'; tag = 'error';
                    } else {
                        title = data.group || 'Evento';
                        body = data.text || 'Novo evento';
                        iconName = 'Bot'; iconBg = '25d366'; tag = 'event';
                    }
                    try { new Notification(title, { body, icon: 'https://ui-avatars.com/api/?name=' + encodeURIComponent(iconName) + '&background=' + iconBg + '&color=fff', tag, renotify: true }); } catch (e) {}
                }
            }
        }

        function selectMessage(el) {
            if (lastSelectedMsgEl) lastSelectedMsgEl.style.outline = '';
            lastSelectedMsgEl = el;
            if (el) el.style.outline = '2px solid var(--wa-green)';
        }

        function openReplyFor(el) {
            const toJid = el.dataset.toJid;
            const messageId = el.dataset.messageId;
            if (!toJid || !messageId) {
                showToast('Esta mensagem não pode ser respondida (sem identificação)');
                return;
            }
            selectMessage(el);
            currentReplyTarget = {
                toJid,
                messageId,
                senderJid: el.dataset.senderJid || undefined,
                fromMe: el.dataset.fromMe === '1',
                group: el.dataset.group,
                phone: el.dataset.phone,
                name: el.dataset.name,
                preview: el.querySelector('.text') ? el.querySelector('.text').innerText : (el.querySelector('.media-container') ? '(mídia)' : '')
            };
            replyTargetLabel.textContent = (currentReplyTarget.group || '') + (currentReplyTarget.phone ? ' · @' + currentReplyTarget.phone : '');
            replyTargetPreview.innerHTML = \`<div class="qname">\${escapeHtml(currentReplyTarget.name || (currentReplyTarget.phone ? '@' + currentReplyTarget.phone : 'Mensagem'))}</div><div class="qtext">\${escapeHtml(currentReplyTarget.preview || '')}</div>\`;
            replyText.value = '';
            modal.classList.add('show');
            setTimeout(() => replyText.focus(), 100);
        }

        function closeReplyModal() {
            modal.classList.remove('show');
            currentReplyTarget = null;
            if (lastSelectedMsgEl) { lastSelectedMsgEl.style.outline = ''; lastSelectedMsgEl = null; }
        }

        async function sendReply() {
            if (!currentReplyTarget) return;
            const text = replyText.value.trim();
            if (!text) { showToast('Digite uma mensagem'); return; }
            replySendBtn.disabled = true;
            try {
                const r = await fetch('/api/reply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        toJid: currentReplyTarget.toJid,
                        text,
                        quotedId: currentReplyTarget.messageId,
                        quotedParticipant: currentReplyTarget.senderJid,
                        quotedFromMe: currentReplyTarget.fromMe
                    })
                });
                const j = await r.json();
                if (j.ok) {
                    showToast('✅ Enviado');
                    closeReplyModal();
                } else {
                    showToast('❌ ' + (j.error || 'falha'));
                }
            } catch (e) {
                showToast('❌ ' + e.message);
            } finally {
                replySendBtn.disabled = false;
            }
        }

        fab.addEventListener('click', () => {
            if (lastSelectedMsgEl) openReplyFor(lastSelectedMsgEl);
            else {
                const cards = chat.querySelectorAll('.msg');
                if (cards.length === 0) { showToast('Nenhuma mensagem'); return; }
                openReplyFor(cards[cards.length - 1]);
            }
        });

        modal.addEventListener('click', (e) => { if (e.target === modal) closeReplyModal(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.classList.contains('show')) closeReplyModal();
        });
        replyText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendReply(); }
        });

        socket.on('history', (history) => { chat.innerHTML = ''; lastDate = ""; history.forEach(data => appendMessage(data, false)); scrollToBottom(); });
        socket.on('msg', (data) => appendMessage(data));
        socket.on('connect', () => { document.getElementById('status').innerText = 'Online'; document.getElementById('status').style.color = 'var(--wa-green)'; });
        socket.on('disconnect', () => { document.getElementById('status').innerText = 'Reconectando...'; document.getElementById('status').style.color = '#ff8182'; });
    </script>
</body>
</html>
    `;
}

module.exports = { init, log, attachSock };