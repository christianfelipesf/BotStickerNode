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
    changeSpeed, getBotName, react, getMessageText,
    flushNow
} = require('./utils');

const { revealViewOnce, handleMediaCommand } = require('./handlers/mediaHandler');
const { setupAI, getModel } = require('./lib/ai');
const dashboard = require('./lib/dashboard');

// --- Configuração Global ---
let config = readConfig();

// Iniciar Dashboard (Modular)
dashboard.init(config);

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
    try { flushNow(); } catch (_) {}
    dashboard.log('error', 'SISTEMA', `ERRO FATAL: ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
    if (reason?.message?.includes('Bad MAC') || reason?.stack?.includes('libsignal')) return;
    console.error('💥 [REJEIÇÃO NÃO TRATADA]:', reason);
    try { flushNow(); } catch (_) {}
    dashboard.log('error', 'SISTEMA', `REJEIÇÃO: ${reason?.message || reason}`);
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
        } else if (u.connection === 'open') {
            const version = require('./utils').getVersion();
            console.log(`\n🟢 ${config.botName.toUpperCase()} CONECTADO! (Versão: ${version})\n`);
            dashboard.log('action', 'SISTEMA', `Bot Conectado (v${version})`);
        }
    });

    sock.ev.on('group-participants.update', async (anu) => {
        if (!isActiveGroup(anu.id)) return;
        try {
            const metadata = await sock.groupMetadata(anu.id);
            for (const num of anu.participants) {
                const phone = num.split('@')[0];
                let text = '';
                if (anu.action === 'add') text = `Entrou no grupo`;
                else if (anu.action === 'remove') text = `Saiu ou foi removido`;
                else if (anu.action === 'promote') text = `Promovido a admin`;
                else if (anu.action === 'demote') text = `Rebaixado de admin`;
                
                if (text) dashboard.log('event', metadata.subject, text, null, phone);
            }
        } catch (e) {
            console.error('Erro no group-participants.update:', e);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        try {
            const m = messages[0];
            if (!m.message || processedMessages.has(m.key.id)) return;
            
            const messageTime = m.messageTimestamp?.low || m.messageTimestamp || 0;
            const bootThreshold = Math.floor(startTime / 1000) + 10;
            if (messageTime < bootThreshold) return;

            processedMessages.add(m.key.id);
            setTimeout(() => processedMessages.delete(m.key.id), 300000);
            
            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = m.key.participant || m.key.remoteJid;
            const text = (getMessageText(m.message) || '').trim();
            const senderName = m.pushName || 'Usuário';

            const isBotActive = !isGroup || isActiveGroup(from);
            
            // --- Enforce Admin Policies (Mute & Anti-Link) ---
            if (isGroup && isBotActive) {
                const groupData = getGroupData(from);
                const admins = await require('./utils').getAdmins(sock, from);
                const isSenderAdmin = admins.includes(sender);
                const isBotAdmin = admins.includes(sock.user.id.split(':')[0] + '@s.whatsapp.net');

                // 1. Mute enforcement
                if (groupData.muted?.includes(sender) && !isSenderAdmin) {
                    if (isBotAdmin) {
                        await sock.sendMessage(from, { delete: m.key });
                        return; // Stop processing muted messages
                    }
                }

                // 2. Anti-link enforcement
                if (groupData.antilink && !isSenderAdmin && isBotAdmin) {
                    const groupLinkRegex = /chat\.whatsapp\.com\/[a-zA-Z0-9]/;
                    if (groupLinkRegex.test(text)) {
                        // Deleta o link
                        await sock.sendMessage(from, { delete: m.key });
                        
                        // Aplica 2 advertências
                        if (!groupData.warnings) groupData.warnings = {};
                        groupData.warnings[sender] = (groupData.warnings[sender] || 0) + 2;
                        const count = groupData.warnings[sender];
                        
                        setGroupData(from, groupData);

                        if (count >= 3) {
                            await sock.groupParticipantsUpdate(from, [sender], 'remove');
                            delete groupData.warnings[sender];
                            setGroupData(from, groupData);
                            return await sock.sendMessage(from, { text: `🚫 @${sender.split('@')[0]} enviou link, atingiu ${count}/3 advertências e foi banido.`, mentions: [sender] });
                        } else {
                            return await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]} enviou link e recebeu 2 advertências. (${count}/3)`, mentions: [sender] });
                        }
                    }
                }
            }

            // Log no Dashboard (Apenas Grupos Ativos)
            if (isGroup && isActiveGroup(from) && isBotActive) {
                const groupMetadata = await sock.groupMetadata(from).catch(() => ({ subject: 'Grupo' }));
                const mediaMsg = getMediaMessage(m.message);
                let mediaInfo = null;

                if (mediaMsg) {
                    try {
                        const buffer = await downloadMediaMessage(m, 'buffer', {}, { 
                            logger: pino({ level: 'silent' }), 
                            reuploadRequest: sock.updateMediaMessage 
                        }).catch(() => null);

                        if (buffer) {
                            const type = mediaMsg.imageMessage ? 'image' : 
                                         mediaMsg.videoMessage ? 'video' : 
                                         mediaMsg.audioMessage ? 'audio' : 
                                         mediaMsg.stickerMessage ? 'sticker' : null;
                            
                            if (type) {
                                const mime = mediaMsg[Object.keys(mediaMsg)[0]].mimetype || 'application/octet-stream';
                                mediaInfo = { 
                                    type, 
                                    url: `data:${mime};base64,${buffer.toString('base64')}` 
                                };
                            }
                        }
                    } catch (e) {
                        console.error('Erro ao baixar mídia para o dashboard:', e.message);
                    }
                }

                dashboard.log('chat', groupMetadata.subject, text, senderName, sender.split('@')[0], mediaInfo);
            }

            if (isGroup && isActiveGroup(from) && text && !text.startsWith(config.prefix)) {
                saveMessage(from, m.pushName || senderName, text);
            }
            
            if (isBotActive && isGroup) {
                const { updateMemberActivity } = require('./utils');
                updateMemberActivity(from, sender, senderName);
            }
            if (isBotActive && (AUTO_VIEW_ONCE || (isGroup && isActiveGroup(from))) && isViewOnce(m.message) && !m.key.fromMe) {
                lastBotResponse = await revealViewOnce(sock, from, m, lastBotResponse, GLOBAL_COOLDOWN);
            }

            if ((text.toLowerCase() === 'prefixo' || text.toLowerCase() === 'prefix') && isBotActive) {
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

            if (isGroup && !isActiveGroup(from) && cmd.name !== 'ativar' && cmd.name !== 'status') return;

            const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => ({ subject: 'Grupo' })) : { subject: 'Privado' };
            dashboard.log('action', groupMetadata.subject, `Comando executado: ${config.prefix}${commandName}`, senderName);

            console.log(`🤖 [INTERAÇÃO] Comando ${config.prefix}${commandName} por ${senderName} em ${from}`);
            incrementCommand();

            const context = {
                from, isGroup, sender, senderName, fullArgsText, args, commandName,
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
