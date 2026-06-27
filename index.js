require('dotenv').config();

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { Boom } = require('@hapi/boom');
const ffmpeg = require('fluent-ffmpeg');
const { execFileSync } = require('child_process');
let _ffmpegChecked = false;
let _ffmpegFound = false;
function ensureFfmpeg() {
    if (_ffmpegChecked) return;
    _ffmpegChecked = true;
    try {
        const finder = process.platform === 'win32' ? 'where' : 'which';
        const out = execFileSync(finder, ['ffmpeg'], { windowsHide: true }).toString().split(/\r?\n/)[0].trim();
        if (out) { ffmpeg.setFfmpegPath(out); _ffmpegFound = true; }
    } catch (_) {}
}

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
const terminalLog = require('./src/services/terminalLog');
const { loadCommands, commands } = require('./src/commands/loader');
const { handleGroupParticipantsUpdate } = require('./src/events/group');
const { handleMessageUpsert } = require('./src/events/message');
const { setupAI } = require('./src/services/ai');
const dashboard = require('./src/dashboard/dashboard');
const news = require('./src/services/news');
const subSessions = require('./src/services/subSessions');
const { startTempCleanup } = require('./src/services/tempCleanup');

// Inicializar Filtro de Logs
initLogger();

// Adiciona [hh:mm:ss] em cada console.log/info/warn/error
trace.patch();

// Captura últimos 50 console.* em ring buffer + arquivo diário (logs/terminal_YYYY-MM-DD.log)
terminalLog.init();

// --- Configuração Global ---
const config = readConfig();

// Expõe serviços para que comandos (ex: set.js) possam controlá-los em runtime.
global.__botServices = { news, dashboard };

// Iniciar Dashboard (Modular) - totalmente isolado
try {
    dashboard.init(config);
    dashboard.setGroupsApi(() => {
        try {
            return listDashboardGroups()
                .map(jid => ({ jid }));
        } catch (_) { return []; }
    });
} catch (e) {
    console.error('⚠️ [dashboard] falha ao iniciar (bot segue normal):', e.message);
}

// Inicializar Inteligência Artificial e Comandos
setupAI(config);
loadCommands({ verbose: false });

// Limpeza automática de temp/ a cada 30 min (arquivos > 1h)
startTempCleanup();

// Restaurar sub-sessões Baileys persistidas (silencioso — só loga o resultado)
(async () => {
    try {
        const restored = await subSessions.restoreFromDisk();
        if (restored.length) {
            console.log(`🔐 [subSessions] restauradas ${restored.length} sessão(ões) do disco`);
        }
    } catch (e) {
        console.error('⚠️ [subSessions] falha ao restaurar:', e.message);
    }
})();

// --- Tratamento de Erros Globais ---
process.on('uncaughtException', (err) => {
    if (err.message?.includes('Bad MAC') || err.stack?.includes('libsignal')) return;
    console.error('💥 [ERRO FATAL]:', err);
    try { flushNow(); } catch (_) {}
    try { dashboard.log('error', 'SISTEMA', `ERRO FATAL: ${err.message}`); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
    if (reason?.message?.includes('Bad MAC') || reason?.stack?.includes('libsignal')) return;
    if (reason?.isBoom) {
        const code = reason.output?.statusCode;
        if (code === 428 || code === 515 || code === 502) return;
    }
    if (reason?.message?.includes('Connection Closed') || reason?.message?.includes('Precondition Required')) return;
    console.error('💥 [REJEIÇÃO NÃO TRATADA]:', reason);
    try { flushNow(); } catch (_) {}
    try { dashboard.log('error', 'SISTEMA', `REJEIÇÃO: ${reason?.message || reason}`); } catch (_) {}
});

// FFmpeg: lazy detection (executado na 1ª vez que precisar)
ensureFfmpeg();

const startTime = Date.now();
try { dashboard.setStartTime(startTime); } catch (_) {}
const _restartNumber = incrementRestart();
try {
    const utils = require('./src/database/utils');
    const _version = utils.getVersion();
    const _stats = utils.readStats();
    const _ts = new Date().toLocaleString('pt-BR');
    dashboard.log('action', 'SISTEMA',
        `🔄 Reinício #${_restartNumber} — v${_version} • ${_ts} • Comandos acumulados: ${_stats.totalCommands || 0}`,
        'Sistema', '—');
} catch (_) {}

/* ========== Boot summary (uma linha por componente, status real) ========== */

const _dashOk = !!dashboard && typeof dashboard.init === 'function';
const _aiOk = !!require('./src/services/ai').getModel();
const _sockDir = fs.existsSync('session') ? '✓' : '✗';
const _nodeVer = process.version;
const _os = `${process.platform} ${process.arch}`;

console.log('');
console.log('═'.repeat(60));
console.log(`🤖  ${config.botName.toUpperCase()} • v${require('./src/database/utils').getVersion()} • Reinício #${_restartNumber}`);
console.log('═'.repeat(60));
console.log(`  📦 comandos     carregando em background...`);
console.log(`  💾 database     logs • bot.db OK`);
console.log(`  🌐 dashboard    ${_dashOk ? '✓ módulo ok' : '✗ falhou'} na porta ${config.dashboardPort}`);
    console.log(`  🤖 IA OpenRouter ${_aiOk ? '✓ ativa (' + (config.aiModel || 'default') + ')' : '✗ sem API key'}`);
console.log(`  📰 news         ${config.newsEnabled !== false ? '✓ ativo' : '✗ desativado'}`);
console.log(`  🎬 ffmpeg       ${_ffmpegChecked ? (_ffmpegFound ? '✓' : 'não encontrado') : '?'}`);
console.log(`  🔐 sessão       ${_sockDir} ${_sockDir === '✓' ? 'salva' : 'QR necessário'}`);
console.log(`  ⚙️  plataforma   ${_os} • Node ${_nodeVer}`);
console.log('═'.repeat(60));

let _qrAttempts = 0;
const MAX_QR_ATTEMPTS = 3;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    const { getCachedBaileysVersion } = require('./src/services/version');
    const version = await getCachedBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        logger: pino({ level: 'fatal' }), 
        printQRInTerminal: false, 
        auth: state, 
        browser: [config.botName, 'Chrome', '120.0.0.0'] 
    });

    try { dashboard.attachSock(sock); } catch (_) {}
    try { dashboard.pushGroupsSnapshot(); } catch (_) {}
    try {
        const curCfg = readConfig();
        if (curCfg.newsEnabled !== false) {
            news.attachSock(sock);
            news.start();
        }
        // news desativado é mostrado no boot summary (não loga aqui)
    } catch (_) {}

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        if (u.qr) {
            _qrAttempts++;
            console.log(`\n⚡ --- QR CODE #${_qrAttempts} --- ⚡`);
            qrcode.generate(u.qr, { small: true });
            try { dashboard.setConnectionState({ status: 'qr', qr: u.qr, phone: null }); } catch (_) {}
            if (_qrAttempts >= MAX_QR_ATTEMPTS) {
                console.log(`⛔ Limite de ${MAX_QR_ATTEMPTS} QR codes atingido. Pare o bot e apague a pasta session/ manualmente ou use o painel admin.`);
            }
        }
        if (u.connection === 'close') {
            const code = (u.lastDisconnect.error instanceof Boom) 
                ? u.lastDisconnect.error.output?.statusCode 
                : u.lastDisconnect.error?.statusCode;
            try { dashboard.setConnectionState({ status: 'disconnected', qr: null, phone: null }); } catch (_) {}
            if (_qrAttempts >= MAX_QR_ATTEMPTS) {
                console.log(`⏸️ QR limit reached (${MAX_QR_ATTEMPTS}). Auto-retry stopped. Delete session folder to retry.`);
                return;
            }
            if (code !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 5000);
            } else { 
                fs.rmSync('session', { recursive: true, force: true }); 
                _qrAttempts = 0;
                setTimeout(startBot, 5000); 
            }
        } else if (u.connection === 'open') {
            const utils = require('./src/database/utils');
            const version = utils.getVersion();
            const stats = utils.readStats();
            const ts = new Date().toLocaleString('pt-BR');
            const phone = sock.user?.id?.split?.(':')?.[0] || null;
            console.log(`\n🟢 ${config.botName.toUpperCase()} CONECTADO! (Versão: ${version})\n`);
            try { dashboard.setConnectionState({ status: 'connected', qr: null, phone }); } catch (_) {}
            try {
                const principalState = require('./src/services/principalState');
                principalState.setConnected({ version, phone });
            } catch (_) {}
            try {
                dashboard.log('action', 'SISTEMA',
                    `🟢 Bot Conectado — v${version} • ${ts} • Comandos: ${stats.totalCommands || 0}`,
                    'Sistema', '—');
            } catch (_) {}
        } else if (u.connection === 'close') {
            try {
                const principalState = require('./src/services/principalState');
                principalState.setDisconnected();
            } catch (_) {}
        }
    });

    // Evento de erro do socket (evita unhandled rejection com Boom 428 etc)
    sock.ev.on('error', (err) => {
        const code = err?.output?.statusCode;
        if (code === 428 || code === 515 || code === 502) return;
        if (err?.message?.includes('Connection Closed') || err?.message?.includes('Precondition Required')) return;
        console.error('🔌 [SOCKET ERROR]:', err?.message || err);
    });

    // Evento de Participantes do Grupo (Adição/Remoção/Admin)
    sock.ev.on('group-participants.update', (anu) => {
        handleGroupParticipantsUpdate(sock, anu);
    });

    // Evento de Recebimento de Mensagens
    sock.ev.on('messages.upsert', (upsert) => {
        handleMessageUpsert(sock, upsert, { commands, config, startTime });
    });
}

startBot();