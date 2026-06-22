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
const { loadCommands, commands } = require('./src/commands/loader');
const { handleGroupParticipantsUpdate } = require('./src/events/group');
const { handleMessageUpsert } = require('./src/events/message');
const { setupAI } = require('./src/services/ai');
const dashboard = require('./src/dashboard/dashboard');

// Inicializar Filtro de Logs
initLogger();

// --- Configuração Global ---
const config = readConfig();

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
loadCommands();

// --- Tratamento de Erros Globais ---
process.on('uncaughtException', (err) => {
    if (err.message?.includes('Bad MAC') || err.stack?.includes('libsignal')) return;
    console.error('💥 [ERRO FATAL]:', err);
    try { flushNow(); } catch (_) {}
    try { dashboard.log('error', 'SISTEMA', `ERRO FATAL: ${err.message}`); } catch (_) {}
});
process.on('unhandledRejection', (reason) => {
    if (reason?.message?.includes('Bad MAC') || reason?.stack?.includes('libsignal')) return;
    console.error('💥 [REJEIÇÃO NÃO TRATADA]:', reason);
    try { flushNow(); } catch (_) {}
    try { dashboard.log('error', 'SISTEMA', `REJEIÇÃO: ${reason?.message || reason}`); } catch (_) {}
});

// Detectar FFmpeg no sistema
try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const systemFfmpeg = execFileSync(finder, ['ffmpeg'], { windowsHide: true }).toString().split(/\r?\n/)[0].trim();
    if (systemFfmpeg) ffmpeg.setFfmpegPath(systemFfmpeg);
} catch (e) {}

const startTime = Date.now();
incrementRestart();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    let version = [2, 3000, 1017531287];
    try {
        const latest = await fetchLatestBaileysVersion();
        if (latest?.version) version = latest.version;
    } catch (err) {}
    
    const sock = makeWASocket({ 
        version, 
        logger: pino({ level: 'fatal' }), 
        printQRInTerminal: false, 
        auth: state, 
        browser: [config.botName, 'Chrome', '120.0.0.0'] 
    });

    try { dashboard.attachSock(sock); } catch (_) {}
    try { dashboard.pushGroupsSnapshot(); } catch (_) {}

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        if (u.qr) { 
            console.log('\n⚡ --- ESCANEIE O QR CODE --- ⚡'); 
            qrcode.generate(u.qr, { small: true }); 
        }
        if (u.connection === 'close') {
            const code = (u.lastDisconnect.error instanceof Boom) 
                ? u.lastDisconnect.error.output?.statusCode 
                : u.lastDisconnect.error?.statusCode;
            if (code !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 5000);
            } else { 
                fs.rmSync('session', { recursive: true, force: true }); 
                setTimeout(startBot, 5000); 
            }
        } else if (u.connection === 'open') {
            const utils = require('./src/database/utils');
            const version = utils.getVersion();
            const stats = utils.readStats();
            const ts = new Date().toLocaleString('pt-BR');
            console.log(`\n🟢 ${config.botName.toUpperCase()} CONECTADO! (Versão: ${version})\n`);
            try {
                dashboard.log('action', 'SISTEMA',
                    `🟢 Bot Conectado — v${version} • ${ts} • Reinício #${stats.restarts || 1} • Comandos: ${stats.totalCommands || 0}`,
                    'Sistema', '—');
            } catch (_) {}
        }
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
