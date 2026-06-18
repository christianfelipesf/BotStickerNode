const http = require('http');
const { Server } = require('socket.io');

let ioServer = null;
const dashboardLogs = []; // In-memory storage (RAM)

function init(config) {
    if (!config.dashboardEnabled) return null;

    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHtml(config.botName));
    });

    ioServer = new Server(server);
    
    ioServer.on('connection', (socket) => {
        // Send history on connection (from RAM)
        socket.emit('history', dashboardLogs);
    });

    server.listen(3000, '0.0.0.0', () => {
        console.log('📊 Dashboard ativo em: http://localhost:3000');
    });

    return ioServer;
}

function log(type, group, text, name = null, phone = null, media = null) {
    const logData = {
        type,
        group: group || 'Sistema',
        text,
        name,
        phone,
        media,
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Save to RAM
    dashboardLogs.push(logData);
    if (dashboardLogs.length > 500) dashboardLogs.shift();

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
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
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
        }

        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
            margin: 0; 
            display: flex; 
            flex-direction: column; 
            height: 100vh; 
            transition: background-color 0.3s, color 0.3s;
            overflow: hidden;
            position: fixed;
            width: 100%;
        }

        /* Themes */
        body.light { background-color: var(--wa-bg-light); color: var(--text-primary-light); }
        body.dark { background-color: var(--wa-bg-dark); color: var(--text-primary-dark); }
        body.oled { background-color: var(--wa-bg-oled); color: var(--text-primary-dark); }

        body.light #header { background-color: var(--header-light); }
        body.dark #header, body.oled #header { background-color: var(--header-dark); }

        body.light .msg { background-color: var(--msg-in-light); color: var(--text-primary-light); }
        body.dark .msg, body.oled .msg { background-color: var(--msg-in-dark); color: var(--text-primary-dark); }

        /* Wallpaper */
        .wallpaper {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png');
            background-repeat: repeat;
            opacity: 0.06;
            pointer-events: none;
            z-index: 0;
        }
        body.oled .wallpaper { opacity: 0.02; }

        #header { 
            padding: 8px 15px; 
            display: flex; 
            align-items: center; 
            gap: 12px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
            z-index: 10; 
            height: 60px;
            box-sizing: border-box;
            flex-shrink: 0;
        }
        #header img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--wa-green); }
        #header-info { flex: 1; min-width: 0; }
        #header-info div:first-child { font-weight: bold; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #header-info div:last-child { font-size: 12px; color: var(--wa-green); font-weight: 500; }

        .theme-selector { display: flex; gap: 5px; }
        .theme-btn { 
            border: none; padding: 5px 8px; border-radius: 15px; cursor: pointer; font-size: 10px; font-weight: bold;
            transition: transform 0.1s; text-transform: uppercase;
        }
        .theme-btn:active { transform: scale(0.95); }
        .btn-light { background: #fff; color: #000; border: 1px solid #ddd; }
        .btn-dark { background: #202c33; color: #fff; }
        .btn-oled { background: #000; color: #fff; border: 1px solid #333; }

        #chat { 
            flex: 1; 
            overflow-y: auto; 
            padding: 15px 10%; 
            display: flex; 
            flex-direction: column; 
            gap: 8px; 
            scroll-behavior: smooth; 
            z-index: 1;
            -webkit-overflow-scrolling: touch;
        }
        @media (max-width: 768px) { #chat { padding: 12px 10px; } .theme-btn { padding: 4px 6px; font-size: 9px; } }

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
        }
        @media (max-width: 480px) { .msg { max-width: 92%; font-size: 14px; } }
        
        .msg.received { align-self: flex-start; border-top-left-radius: 0; }
        
        .msg.system-error { background-color: #ffdce0 !important; color: #86181d !important; align-self: center; border-radius: 8px; border: 1px solid #f1aeb5; max-width: 95%; font-size: 13px; text-align: center; }
        body.dark .msg.system-error, body.oled .msg.system-error { background-color: #442726 !important; color: #ff8182 !important; border-color: #603030; }

        .msg.bot-action { background-color: #e7f3ff !important; color: #004085 !important; align-self: center; border-radius: 8px; border: 1px solid #b8daff; max-width: 95%; font-size: 13px; text-align: center; }
        body.dark .msg.bot-action, body.oled .msg.bot-action { background-color: #1a2733 !important; color: #7abaff !important; border-color: #2b4560; }

        .msg.member-event { background-color: #d4edda !important; color: #155724 !important; align-self: center; border-radius: 8px; border: 1px solid #c3e6cb; max-width: 95%; font-size: 12px; text-align: center; }
        body.dark .msg.member-event, body.oled .msg.member-event { background-color: #1b2e21 !important; color: #72cf8a !important; border-color: #2b4f35; }
        
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
        
        /* Media Styles */
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
    </style>
</head>
<body class="dark">
    <div class="wallpaper"></div>
    <div id="header">
        <img src="https://ui-avatars.com/api/?name=${botName.replace(/\s/g, '+')}&background=128c7e&color=fff" id="bot-logo">
        <div id="header-info">
            <div>${botName}</div>
            <div id="status">Conectando...</div>
        </div>
        <div class="theme-selector">
            <button class="theme-btn btn-light" onclick="setTheme('light')">Sol</button>
            <button class="theme-btn btn-dark" onclick="setTheme('dark')">Lua</button>
            <button class="theme-btn btn-oled" onclick="setTheme('oled')">OLED</button>
        </div>
    </div>
    <div id="chat"></div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const chat = document.getElementById('chat');
        let lastDate = "";

        function setTheme(theme) {
            document.body.className = theme;
            localStorage.setItem('wa_theme', theme);
        }
        const savedTheme = localStorage.getItem('wa_theme') || 'dark';
        setTheme(savedTheme);

        function scrollToBottom() {
            setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 100);
        }

        function getUserColor(phone) {
            if (!phone) return '#53bdeb';
            const colors = [
                '#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', 
                '#e67e22', '#1abc9c', '#d35400', '#c0392b', '#27ae60',
                '#2980b9', '#8e44ad', '#f39c12', '#16a085', '#7f8c8d'
            ];
            let hash = 0;
            for (let i = 0; i < phone.length; i++) {
                hash = phone.charCodeAt(i) + ((hash << 5) - hash);
            }
            return colors[Math.abs(hash) % colors.length];
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
            
            let mediaHtml = '';
            if (data.media) {
                if (data.media.type === 'image') mediaHtml = \`<div class="media-container"><img src="\${data.media.url}"></div>\`;
                else if (data.media.type === 'video') mediaHtml = \`<div class="media-container"><video src="\${data.media.url}" controls></video></div>\`;
                else if (data.media.type === 'audio') mediaHtml = \`<div class="media-container"><audio src="\${data.media.url}" controls></audio></div>\`;
                else if (data.media.type === 'sticker') mediaHtml = \`<div class="media-container"><img src="\${data.media.url}" style="width: 120px; height: 120px; background: none;"></div>\`;
            }

            wrapper.innerHTML = \`
                <div class="msg \${msgClass}">
                    \${data.type === 'chat' ? \`
                    <div class="sender-info">
                        <span class="sender" style="color: \${userColor}">\${data.name || 'Usuário'}</span>
                        <span class="phone">\${data.phone ? '@' + data.phone : ''}</span>
                        <span class="group-name">\${data.group || 'Grupo'}</span>
                    </div>
                    \` : \`
                    <div class="sender-info">
                        \${typeTag}
                        <span class="group-name">\${data.group || 'Sistema'}</span>
                    </div>
                    \`}
                    \${mediaHtml}
                    \${data.text ? \`<div class="text">\${data.text}</div>\` : ''}
                    <div class="time-wrapper">
                        <div class="time">\${data.time || new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                    </div>
                </div>
            \`;
            chat.appendChild(wrapper);
            if (isNew) scrollToBottom();
        }

        socket.on('history', (history) => {
            chat.innerHTML = '';
            lastDate = "";
            history.forEach(data => appendMessage(data, false));
            scrollToBottom();
        });

        socket.on('msg', (data) => appendMessage(data));
        socket.on('connect', () => {
            document.getElementById('status').innerText = 'Online';
            document.getElementById('status').style.color = 'var(--wa-green)';
        });
        socket.on('disconnect', () => {
            document.getElementById('status').innerText = 'Reconectando...';
            document.getElementById('status').style.color = '#ff8182';
        });
    </script>
</body>
</html>
    `;
}

module.exports = { init, log };
