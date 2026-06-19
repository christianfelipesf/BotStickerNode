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
const dashboardCacheMedia = dashboard.cacheMedia;

// --- Configuração Global ---
let config = readConfig();

// Iniciar Dashboard (Modular)
dashboard.init(config);
const dashboardAttachSock = dashboard.attachSock;

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

// Silencia logs feios do libsignal/Baileys (ex.: "Closing session: SessionEntry {...}", "Failed to decrypt...", "Bad MAC", etc.)
// O libsignal usa process.stdout.write e process.stderr.write diretamente,
// entao precisamos interceptar a escrita em baixo nivel, nao apenas console.*
const _LIB_PATTERNS = [
    /Closing (open )?session/i,
    /Closing session:/i,
    /SessionEntry\s*\{/i,
    /chainKey:/i,
    /ephemeralKeyPair/i,
    /lastRemoteEphemeralKey/i,
    /remoteIdentityKey/i,
    /indexInfo/i,
    /messageKeys/i,
    /registrationId/i,
    /currentRatchet/i,
    /baseKey/i,
    /Failed to decrypt message with any known session/i,
    /Session error:/i,
    /Bad MAC\s*Error/i,
    /verifyMAC/i,
    /doDecryptWhisperMessage/i,
    /decryptWithSessions/i,
    /\[as awaitable\]/i,
    /_asyncQueueExecutor/i,
    /libsignal/i,
    /crypto\.js/i,
    /session_cipher\.js/i,
    /queue_job\.js/i,
    /at\s+Object\./i,
    /at\s+SessionCipher/i,
    /at\s+async\s+[\d.]+\s*\[as awaitable\]/i,
    /Buffer\s+[0-9a-f]{2}\s+[0-9a-f]{2}/i,
];
const _isLibsignalNoise = (str) => _LIB_PATTERNS.some(re => re.test(str));

const _wrapStream = (streamName) => {
    const stream = process[streamName];
    if (!stream || !stream.write) return;
    const originalWrite = stream.write.bind(stream);
    stream.write = function (chunk, encoding, cb) {
        try {
            const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            if (_isLibsignalNoise(text)) {
                if (typeof cb === 'function') cb();
                return true;
            }
        } catch (_) {}
        return originalWrite(chunk, encoding, cb);
    };
    return stream;
};
_wrapStream('stdout');
_wrapStream('stderr');

const _originalLog = console.log;
const _originalInfo = console.info;
const _originalDebug = console.debug;
const _originalWarn = console.warn;
const _silentFilter = (args) => {
    const msg = args.map(a => (typeof a === 'string' ? a : (a?.message || a?.toString?.() || ''))).join(' ');
    return _isLibsignalNoise(msg);
};
console.log = (...args) => { if (!_silentFilter(args)) _originalLog.apply(console, args); };
console.info = (...args) => { if (!_silentFilter(args)) _originalInfo.apply(console, args); };
console.debug = (...args) => { if (!_silentFilter(args)) _originalDebug.apply(console, args); };
console.warn = (...args) => { if (!_silentFilter(args)) _originalWarn.apply(console, args); };

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
    
    const sock = makeWASocket({ version, logger: pino({ level: 'fatal' }), printQRInTerminal: false, auth: state, browser: [config.botName, 'Chrome', '120.0.0.0'] });
    try { dashboardAttachSock(sock); } catch (_) {}
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
                
                if (text) dashboard.log('event', metadata.subject, text, null, phone, null, { toJid: anu.id, senderJid: num, fromMe: false });
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
                const utilsRef = require('./utils');
                const adminsRaw = await utilsRef.getAdmins(sock, from);
                const senderNorm = utilsRef.normalizeJid(sender);
                const senderUser = senderNorm.split('@')[0];
                const isSenderAdmin = adminsRaw.some(p => {
                    const candidates = [p.id, p.jid, p.lid].filter(Boolean).map(j => utilsRef.normalizeJid(j));
                    return candidates.some(c => c.split('@')[0] === senderUser);
                });
                const isBotAdmin = await utilsRef.botIsAdmin(sock, from);

                // 1. Mute enforcement (lista persistida em SQLite, expira em 12h)
                if (!isSenderAdmin && utilsRef.isMuted(from, sender)) {
                    if (isBotAdmin) {
                        try {
                            await sock.sendMessage(from, { delete: m.key });
                        } catch (delErr) {
                            console.error('❌ Falha ao apagar mensagem de mutado:', delErr.message);
                        }
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
                let hidden = false;
                let ephemeral = false;

                if (mediaMsg) {
                    try {
                        const buffer = await downloadMediaMessage(m, 'buffer', {}, {
                            logger: pino({ level: 'fatal' }),
                            reuploadRequest: sock.updateMediaMessage
                        }).catch(() => null);

                        if (buffer) {
                            const type = mediaMsg.imageMessage ? 'image' :
                                         mediaMsg.videoMessage ? 'video' :
                                         mediaMsg.audioMessage ? 'audio' :
                                         mediaMsg.stickerMessage ? 'sticker' : null;

                            if (type) {
                                const innerKey = Object.keys(mediaMsg)[0];
                                const inner = mediaMsg[innerKey];
                                const mime = inner.mimetype || 'application/octet-stream';
                                const isVO = !!inner.viewOnce;
                                mediaInfo = {
                                    type,
                                    url: `data:${mime};base64,${buffer.toString('base64')}`
                                };
                                if (type === 'image' || type === 'video' || type === 'audio') {
                                    hidden = isVO;
                                }
                                // Cache para hidratação de citações futuras
                                try {
                                    dashboardCacheMedia(m.key.id, {
                                        bufferBase64: buffer.toString('base64'),
                                        mime,
                                        type,
                                        fileName: inner.fileName || null,
                                        text: inner.caption || null,
                                        fromJid: from
                                    });
                                } catch (_) {}
                            }
                        }
                    } catch (e) {
                        console.error('Erro ao baixar mídia para o dashboard:', e.message);
                    }
                }

                if (m.message?.ephemeralMessage) ephemeral = true;

                // quoted (mensagem citada/resposta)
                const qi = utilsRef.getContextInfo(m.message);
                let quotedInfo = null;
                if (qi?.quotedMessage) {
                    const qText = qi.quotedMessage.conversation
                        || qi.quotedMessage.extendedTextMessage?.text
                        || qi.quotedMessage.imageMessage?.caption
                        || qi.quotedMessage.videoMessage?.caption
                        || qi.quotedMessage.documentMessage?.caption
                        || '';
                    const qSender = qi.participant || null;
                    const qSenderName = (() => {
                        try {
                            const p = groupMetadata.participants?.find(pp => pp.id === qSender);
                            return p?.name || p?.notify || (qSender ? '@' + qSender.split('@')[0] : null);
                        } catch (_) { return qSender ? '@' + qSender.split('@')[0] : null; }
                    })();
                    quotedInfo = {
                        text: qText || null,
                        hasMedia: !!(qi.quotedMessage.imageMessage || qi.quotedMessage.videoMessage || qi.quotedMessage.audioMessage || qi.quotedMessage.stickerMessage || qi.quotedMessage.documentMessage),
                        senderJid: qSender,
                        phone: qSender ? qSender.split('@')[0] : null,
                        name: qSenderName
                    };
                }

                const logType = hidden ? 'viewonce' : 'chat';
                dashboard.log(logType,
                    groupMetadata.subject,
                    text || (mediaInfo ? `[${mediaInfo.type}${hidden ? ' • viewOnce' : ''}]` : ''),
                    senderName,
                    sender.split('@')[0],
                    mediaInfo,
                    {
                        toJid: from,
                        messageId: m.key.id,
                        senderJid: sender,
                        fromMe: !!m.key.fromMe,
                        quoted: quotedInfo,
                        hidden,
                        ephemeral
                    }
                );
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
            dashboard.log('action', groupMetadata.subject, `Comando executado: ${config.prefix}${commandName}`, senderName, sender.split('@')[0], null, { toJid: from, messageId: m.key.id, senderJid: sender, fromMe: !!m.key.fromMe });

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
