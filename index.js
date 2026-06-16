const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    downloadMediaMessage,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const { execSync, exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');

const {
    isActiveGroup, activateGroup, deactivateGroup,
    getGroupData, setGroupData, saveGroupMenuImage,
    isViewOnce, getMediaMessage, mediaToSticker, stickerToMedia,
    readStats, incrementRestart, incrementCommand, formatUptime,
    readConfig, writeConfig, saveMessage, getChatHistory,
    changeSpeed, getBotName, react, getMessageText
} = require('./utils');

const { revealViewOnce, handleMediaCommand } = require('./handlers/mediaHandler');
const { setupAI, getModel } = require('./lib/ai');

// --- Configuração Global ---
let config = readConfig();
let model = setupAI(config);
const commands = new Map();

function loadCommands() {
    const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(`./commands/${file}`);
        commands.set(command.name, command);
        console.log(`✅ Comando carregado: ${command.name}`);
    }
}
loadCommands();

// --- Tratamento de Erros Globais ---
process.on('uncaughtException', (err) => {
    if (err.message?.includes('Bad MAC') || err.stack?.includes('libsignal')) return;
    console.error('💥 [ERRO FATAL]:', err);
});
process.on('unhandledRejection', (reason) => {
    if (reason?.message?.includes('Bad MAC') || reason?.stack?.includes('libsignal')) return;
    console.error('💥 [REJEIÇÃO NÃO TRATADA]:', reason);
});

// Detectar FFmpeg
try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const systemFfmpeg = execSync(cmd).toString().split('\r\n')[0].split('\n')[0].trim();
    if (systemFfmpeg) ffmpeg.setFfmpegPath(systemFfmpeg);
} catch (e) {}

const startTime = Date.now();
incrementRestart();
const processedMessages = new Set();
const GLOBAL_COOLDOWN = 1000;
let lastBotResponse = 0;
const AUTO_VIEW_ONCE = true;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    let version = [2, 3000, 1017531287];
    try {
        const latest = await fetchLatestBaileysVersion();
        if (latest?.version) version = latest.version;
    } catch (err) {}
    
    const sock = makeWASocket({ version, logger: pino({ level: 'silent' }), printQRInTerminal: false, auth: state, browser: [config.botName, 'Chrome', '120.0.0.0'] });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        if (u.qr) { console.log('\n⚡ --- ESCANEIE O QR CODE --- ⚡'); qrcode.generate(u.qr, { small: true }); }
        if (u.connection === 'close') {
            const code = (u.lastDisconnect.error instanceof Boom) ? u.lastDisconnect.error.output?.statusCode : u.lastDisconnect.error?.statusCode;
            if (code !== DisconnectReason.loggedOut) setTimeout(startBot, 5000);
            else { fs.rmSync('session', { recursive: true, force: true }); setTimeout(startBot, 5000); }
        } else if (u.connection === 'open') console.log(`\n🟢 ${config.botName.toUpperCase()} CONECTADO!\n`);
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        try {
            const m = messages[0];
            if (!m.message || processedMessages.has(m.key.id)) return;
            processedMessages.add(m.key.id);
            setTimeout(() => processedMessages.delete(m.key.id), 300000);
            
            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = m.key.participant || m.key.remoteJid;
            const text = (getMessageText(m.message) || '').trim();
            const senderName = m.pushName || 'Usuário';

            if (text && !text.startsWith(config.prefix) && (!isGroup || isActiveGroup(from))) saveMessage(from, m.pushName || senderName, text);
            if ((AUTO_VIEW_ONCE || (isGroup && isActiveGroup(from))) && isViewOnce(m.message) && !m.key.fromMe) {
                lastBotResponse = await revealViewOnce(sock, from, m, lastBotResponse, GLOBAL_COOLDOWN);
            }

            if (text.toLowerCase() === 'prefixo' && (!isGroup || isActiveGroup(from))) {
                const stats = readStats();
                const now = Date.now();
                const currentBotName = getBotName(from, config);
                const statusText = `🌌 *${currentBotName}*\n\n⌨️ *Prefixo:* ${config.prefix}\n⏱️ *Uptime:* ${formatUptime((now - startTime) / 1000)}\n⌨️ *Comandos:* ${stats.totalCommands}\n💻 *Plataforma:* ${process.platform === 'win32' ? 'Windows' : 'Linux'}`;
                lastBotResponse = await react(sock, m, 'ℹ️', lastBotResponse, GLOBAL_COOLDOWN);
                return await sock.sendMessage(from, { text: statusText }, { quoted: m });
            }

            if (!text.startsWith(config.prefix)) return;
            const args = text.slice(config.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const fullArgsText = args.join(' ');

            const cmd = commands.get(commandName) || Array.from(commands.values()).find(c => c.aliases?.includes(commandName));
            if (!cmd) return;

            console.log(`🤖 [INTERAÇÃO] Comando ${config.prefix}${commandName} por ${senderName} em ${from}`);
            incrementCommand();

            const context = {
                from, isGroup, sender, senderName, fullArgsText, args,
                config, utils: require('./utils'), model: getModel(), startTime,
                lastBotResponse, GLOBAL_COOLDOWN,
                mediaHandler: require('./handlers/mediaHandler'),
                ai: require('./lib/ai')
            };

            const result = await cmd.execute(sock, m, context);
            if (result !== undefined) lastBotResponse = result;

        } catch (e) {
            console.error('Erro ao processar mensagem:', e);
        }
    });
}
startBot();
