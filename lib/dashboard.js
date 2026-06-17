const http = require('http');
const { Server } = require('socket.io');

let ioServer = null;

function init(config) {
    if (!config.dashboardEnabled) return null;

    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHtml(config.botName));
    });

    ioServer = new Server(server);
    server.listen(3000, '0.0.0.0', () => {
        console.log('📊 Dashboard ativo em: http://localhost:3000');
    });

    return ioServer;
}

function log(type, group, text, name = null, phone = null) {
    if (ioServer) {
        ioServer.emit('msg', {
            type,
            group: group || 'Sistema',
            text,
            name,
            phone,
            timestamp: Date.now(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    }
}

function getHtml(botName) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>${botName} Monitor</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #0b141a; background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png'); background-blend-mode: overlay; color: #e9edef; margin: 0; display: flex; flex-direction: column; height: 100vh; }
        #header { background-color: #202c33; padding: 10px 15px; display: flex; align-items: center; gap: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.4); z-index: 10; }
        #header img { width: 40px; height: 40px; border-radius: 50%; background: #374045; }
        #header-info { flex: 1; }
        #header-info div:first-child { font-weight: bold; font-size: 16px; }
        #header-info div:last-child { font-size: 12px; color: #8696a0; }
        #chat { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 6px; scroll-behavior: smooth; }
        .msg-wrapper { display: flex; flex-direction: column; }
        .msg { max-width: 90%; padding: 8px 12px; border-radius: 8px; font-size: 14px; position: relative; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); animation: fadeIn 0.3s ease; }
        .msg.received { background-color: #202c33; align-self: flex-start; border-top-left-radius: 0; }
        .msg.system-error { background-color: #3e1b1b; align-self: center; border-radius: 8px; border: 1px solid #721c24; }
        .msg.bot-action { background-color: #1b283e; align-self: center; border-radius: 8px; border: 1px solid #1c4b72; }
        .msg.member-event { background-color: #1b3e2b; align-self: center; border-radius: 8px; border: 1px solid #1c723c; }
        
        .sender-info { display: flex; gap: 8px; align-items: baseline; margin-bottom: 2px; flex-wrap: wrap; }
        .sender { color: #53bdeb; font-size: 12.5px; font-weight: bold; }
        .phone { color: #8696a0; font-size: 11px; }
        .group-name { color: #e9edef; font-size: 11px; font-weight: bold; opacity: 0.9; background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 3px; }
        .type-tag { font-size: 10px; text-transform: uppercase; padding: 1px 4px; border-radius: 3px; font-weight: bold; }
        .tag-error { background: #721c24; }
        .tag-action { background: #1c4b72; }
        .tag-event { background: #1c723c; }
        
        .text { line-height: 1.4; word-wrap: break-word; white-space: pre-wrap; }
        .time-wrapper { display: flex; justify-content: flex-end; align-items: center; gap: 4px; }
        .time { font-size: 10px; color: #8696a0; margin-top: 4px; }
        .date-divider { align-self: center; background: #182229; padding: 5px 12px; border-radius: 7px; font-size: 12px; color: #8696a0; margin: 15px 0; text-transform: uppercase; box-shadow: 0 1px 0.5px rgba(0,0,0,0.13); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); }
    </style>
</head>
<body>
    <div id="header">
        <img src="https://ui-avatars.com/api/?name=${botName.replace(/\s/g, '+')}&background=202c33&color=53bdeb">
        <div id="header-info">
            <div>${botName} - Monitor</div>
            <div id="status">Conectado ao Bot</div>
        </div>
    </div>
    <div id="chat"></div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const chat = document.getElementById('chat');
        let lastDate = "";

        const savedLogs = JSON.parse(sessionStorage.getItem('chat_logs') || '[]');
        savedLogs.forEach(data => appendMessage(data, false));
        scrollToBottom();

        function scrollToBottom() {
            setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 50);
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
            if (data.type === 'error') { msgClass = "system-error"; typeTag = '<span class="type-tag tag-error">ERRO</span>'; }
            else if (data.type === 'action') { msgClass = "bot-action"; typeTag = '<span class="type-tag tag-action">AÇÃO</span>'; }
            else if (data.type === 'event') { msgClass = "member-event"; typeTag = '<span class="type-tag tag-event">EVENTO</span>'; }

            wrapper.innerHTML = \`
                <div class="msg \${msgClass}">
                    <div class="sender-info">
                        \${typeTag}
                        <span class="group-name">\${data.group || 'Sistema'}</span>
                        \${data.name ? \`<span class="sender">\${data.name}</span>\` : ''}
                        \${data.phone ? \`<span class="phone">\${data.phone}</span>\` : ''}
                    </div>
                    <div class="text">\${data.text}</div>
                    <div class="time-wrapper">
                        <div class="time">\${data.time || new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                    </div>
                </div>
            \`;
            chat.appendChild(wrapper);
            if (isNew) {
                scrollToBottom();
                saveToHistory(data);
            }
        }

        function saveToHistory(data) {
            let logs = JSON.parse(sessionStorage.getItem('chat_logs') || '[]');
            logs.push(data);
            if (logs.length > 500) logs.shift();
            sessionStorage.setItem('chat_logs', JSON.stringify(logs));
        }

        socket.on('msg', (data) => appendMessage(data));
        socket.on('connect', () => document.getElementById('status').innerText = 'Online');
        socket.on('disconnect', () => document.getElementById('status').innerText = 'Offline - Reconectando...');
    </script>
</body>
</html>
    `;
}

module.exports = { init, log };
