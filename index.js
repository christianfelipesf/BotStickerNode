const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { Boom } = require('@hapi/boom');
const { execFileSync } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

// Utilidades e Configurações
const {
    isActiveGroup,
    listDashboardGroups,
    incrementRestart,
    readConfig,
    flushNow
} = require('./src/database/utils');

// Modulos Isolados (Refatoração AI.txt)
const { initLogger } = require('./src/services/logger');
const trace = require('./src/services/trace');
const { loadCommands, commands } = require('./src/commands/loader');
const { handleGroupParticipantsUpdate } = require('./src/events/group');
const { handleMessageUpsert } = require('./src/events/message');
const { setupAI } = require('./src/services/ai');
const dashboard = require('./src/dashboard/dashboard');
const news = require('./src/services/news');

console.log(trace.section('INICIALIZAÇÃO DO PROCESSO'));
console.log(trace.step('boot', 'node', `pid=${process.pid} plataforma=${process.platform} node=${process.version}`));

// Inicializar Filtro de Logs
try {
    initLogger();
    console.log(trace.step('boot', 'logger', 'initLogger ok (filtro libsignal ativo)'));
} catch (e) {
    console.error(trace.step('boot', 'logger ERRO', e.message));
}

// --- Configuração Global ---
let config;
try {
    config = readConfig();
    console.log(trace.step('boot', 'config', `lido (prefix=${config.prefix} botName=${config.botName})`));
} catch (e) {
    console.error(trace.step('boot', 'config ERRO', e.message));
    config = { prefix: '!', botName: 'Bot' };
}

// Expõe serviços para que comandos (ex: set.js) possam controlá-los em runtime.
global.__botServices = { news, dashboard };
console.log(trace.step('boot', 'globals', '__botServices publicado'));

// Iniciar Dashboard (Modular) - totalmente isolado
console.log(trace.step('boot', 'dashboard', 'iniciando...'));
try {
    dashboard.init(config);
    dashboard.setGroupsApi(() => {
        try {
            return listDashboardGroups()
                .map(jid => ({ jid }));
        } catch (_) { return []; }
    });
    console.log(trace.step('boot', 'dashboard', 'ok'));
} catch (e) {
    console.error(trace.step('boot', 'dashboard ERRO', `${e.message} (bot segue normal)`));
}

// Inicializar Inteligência Artificial e Comandos
console.log(trace.step('boot', 'AI', 'setupAI...'));
try { setupAI(config); console.log(trace.step('boot', 'AI', 'ok')); } catch (e) { console.error(trace.step('boot', 'AI ERRO', e.message)); }
console.log(trace.step('boot', 'commands', 'loadCommands...'));
try { loadCommands(); console.log(trace.step('boot', 'commands', `ok (${commands.size} comandos carregados)`)); } catch (e) { console.error(trace.step('boot', 'commands ERRO', e.message)); }

// --- Tratamento de Erros Globais ---
process.on('uncaughtException', (err) => {
    if (err.message?.includes('Bad MAC') || err.stack?.includes('libsignal')) return;
    console.error(trace.step('erro', 'uncaughtException', `${err.message} | stack[0]=${(err.stack||'').split('\n')[1]?.trim() || ''}`));
    console.error('💥 [ERRO FATAL]:', err);
    try { flushNow(); } catch (_) {}
    try { dashboard.log('error', 'SISTEMA', `ERRO FATAL: ${err.message}`); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
    if (reason?.message?.includes('Bad MAC') || reason?.stack?.includes('libsignal')) return;
    const msg = reason?.message || String(reason);
    console.error(trace.step('erro', 'unhandledRejection', `${msg} | stack[0]=${(reason?.stack||'').split('\n')[1]?.trim() || ''}`));
    console.error('💥 [REJEIÇÃO NÃO TRATADA]:', reason);
    try { flushNow(); } catch (_) {}
    try { dashboard.log('error', 'SISTEMA', `REJEIÇÃO: ${reason?.message || reason}`); } catch (_) {}
});
process.on('warning', (w) => {
    console.warn(trace.step('erro', 'process warning', `${w.name}: ${w.message}`));
});

// Detectar FFmpeg no sistema
console.log(trace.step('boot', 'ffmpeg', 'procurando binário no sistema...'));
try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const systemFfmpeg = execFileSync(finder, ['ffmpeg'], { windowsHide: true }).toString().split(/\r?\n/)[0].trim();
    if (systemFfmpeg) {
        ffmpeg.setFfmpegPath(systemFfmpeg);
        console.log(trace.step('boot', 'ffmpeg', `ok → ${systemFfmpeg}`));
    } else {
        console.log(trace.step('boot', 'ffmpeg', 'não encontrado no PATH (usando padrão do fluent-ffmpeg)'));
    }
} catch (e) {
    console.log(trace.step('boot', 'ffmpeg', `não encontrado (${e.message?.split('\n')[0]}) — usando padrão`));
}

const startTime = Date.now();
const _restartNumber = incrementRestart();
console.log(trace.step('boot', 'restart', `contador=#${_restartNumber} startTime gravado`));
try {
    const utils = require('./src/database/utils');
    const _version = utils.getVersion();
    const _stats = utils.readStats();
    const _ts = new Date().toLocaleString('pt-BR');
    dashboard.log('action', 'SISTEMA',
        `🔄 Reinício #${_restartNumber} — v${_version} • ${_ts} • Comandos acumulados: ${_stats.totalCommands || 0}`,
        'Sistema', '—');
    console.log(trace.step('boot', 'dashboard.log', `Reinício #${_restartNumber} registrado`));
} catch (e) { console.error(trace.step('boot', 'dashboard.log ERRO', e.message)); }

let _connectAttempt = 0;
async function startBot() {
    _connectAttempt += 1;
    console.log(trace.section(`CONEXÃO WHATSAPP (tentativa #${_connectAttempt})`));
    console.log(trace.step('sock', 'authState', 'carregando session/...'));
    let state, saveCreds;
    try {
        ({ state, saveCreds } = await useMultiFileAuthState('session'));
        console.log(trace.step('sock', 'authState', `ok (creds.json=${fs.existsSync('session/creds.json')})`));
    } catch (e) {
        console.error(trace.step('sock', 'authState ERRO', e.message));
        throw e;
    }
    let version = [2, 3000, 1017531287];
    try {
        const latest = await fetchLatestBaileysVersion();
        if (latest?.version) version = latest.version;
        console.log(trace.step('sock', 'baileysVersion', `v${version.join('.')}`));
    } catch (err) {
        console.log(trace.step('sock', 'baileysVersion', `falhou (${err.message}) — usando fallback ${version.join('.')}`));
    }
    
    console.log(trace.step('sock', 'makeWASocket', 'criando socket...'));
    let sock;
    try {
        sock = makeWASocket({ 
            version, 
            logger: pino({ level: 'fatal' }), 
            printQRInTerminal: false, 
            auth: state, 
            browser: [config.botName, 'Chrome', '120.0.0.0'] 
        });
        console.log(trace.step('sock', 'makeWASocket', `ok (browser=${config.botName}/Chrome)`));
    } catch (e) {
        console.error(trace.step('sock', 'makeWASocket ERRO', e.message));
        console.log(trace.step('sock', 'retry', 'reconectando em 5s...'));
        return setTimeout(startBot, 5000);
    }

    try { dashboard.attachSock(sock); console.log(trace.step('sock', 'dashboard.attachSock', 'ok')); } catch (e) { console.error(trace.step('sock', 'dashboard.attachSock ERRO', e.message)); }
    try { dashboard.pushGroupsSnapshot(); console.log(trace.step('sock', 'dashboard.pushGroupsSnapshot', 'ok')); } catch (e) { console.error(trace.step('sock', 'dashboard.pushGroupsSnapshot ERRO', e.message)); }
    try {
        const curCfg = readConfig();
        if (curCfg.newsEnabled !== false) {
            news.attachSock(sock);
            news.start();
            console.log(trace.step('sock', 'news', 'ativado e iniciado'));
        } else {
            console.log(`📰 [news] desativado pela config (newsEnabled=false).`);
            console.log(trace.step('sock', 'news', 'desativado pela config'));
        }
    } catch (e) {
        console.error(trace.step('sock', 'news ERRO', e.message));
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        if (u.qr) { 
            console.log(trace.step('sock', 'QR', 'novo QR gerado — escaneie abaixo'));
            console.log('\n⚡ --- ESCANEIE O QR CODE --- ⚡'); 
            qrcode.generate(u.qr, { small: true }); 
        }
        if (u.connection === 'close') {
            const code = (u.lastDisconnect.error instanceof Boom) 
                ? u.lastDisconnect.error.output?.statusCode 
                : u.lastDisconnect.error?.statusCode;
            const reason = u.lastDisconnect?.error?.message || '(sem mensagem)';
            console.error(trace.step('sock', 'connection CLOSE', `code=${code} reason="${reason}" loggedOut=${code === DisconnectReason.loggedOut}`));
            if (code !== DisconnectReason.loggedOut) {
                console.log(trace.step('sock', 'reconexão', 'agendada em 5s (session mantida)'));
                setTimeout(startBot, 5000);
            } else { 
                console.log(trace.step('sock', 'reconexão', 'loggedOut → removendo session/, reconectando em 5s'));
                fs.rmSync('session', { recursive: true, force: true }); 
                setTimeout(startBot, 5000); 
            }
        } else if (u.connection === 'open') {
            console.log(trace.step('sock', 'connection OPEN', `autenticado como ${sock.user?.id || '?'}`));
            const utils = require('./src/database/utils');
            const version = utils.getVersion();
            const stats = utils.readStats();
            const ts = new Date().toLocaleString('pt-BR');
            console.log(`\n🟢 ${config.botName.toUpperCase()} CONECTADO! (Versão: ${version})\n`);
            try {
                dashboard.log('action', 'SISTEMA',
                    `🟢 Bot Conectado — v${version} • ${ts} • Comandos: ${stats.totalCommands || 0}`,
                    'Sistema', '—');
                console.log(trace.step('sock', 'dashboard.log', 'evento de conexão registrado'));
            } catch (e) { console.error(trace.step('sock', 'dashboard.log ERRO', e.message)); }
        } else if (u.connection === 'connecting') {
            console.log(trace.step('sock', 'connection', 'connecting...'));
        }
    });

    // Evento de Participantes do Grupo (Adição/Remoção/Admin)
    sock.ev.on('group-participants.update', (anu) => {
        console.log(trace.step('evt', 'group-participants.update', `group=${anu?.id} action=${anu?.action} count=${anu?.participants?.length || 0}`));
        try { handleGroupParticipantsUpdate(sock, anu); } catch (e) { console.error(trace.step('evt', 'group ERRO', e.message)); }
    });

    // Evento de Recebimento de Mensagens
    sock.ev.on('messages.upsert', (upsert) => {
        const n = upsert?.messages?.length || 0;
        if (n > 0) {
            const first = upsert.messages[0];
            const from = first?.key?.remoteJid || '?';
            const isCmd = (() => {
                try {
                    const t = first?.message?.conversation || first?.message?.extendedTextMessage?.text || '';
                    return t.startsWith(config.prefix);
                } catch (_) { return false; }
            })();
            if (isCmd) {
                console.log(trace.step('evt', 'messages.upsert', `from=${from} count=${n} type=${upsert.type} (comando)`));
            }
        }
        try { handleMessageUpsert(sock, upsert, { commands, config, startTime }); } catch (e) { console.error(trace.step('evt', 'messages.upsert ERRO', e.message)); }
    });

    console.log(trace.step('sock', 'listeners', 'creds.update / connection.update / group-participants.update / messages.upsert registrados'));
    console.log(trace.step('boot', 'startBot', `instância #${_connectAttempt} pronta, aguardando conexão...`));
}

console.log(trace.step('boot', 'startBot', 'chamando startBot()...'));
startBot().catch((e) => {
    console.error(trace.step('boot', 'startBot ERRO FATAL', e.message));
    console.error(e);
});
