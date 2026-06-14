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
const yts = require('yt-search');
const ffmpeg = require('fluent-ffmpeg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const readline = require('readline');

// --- Tratamento de Erros Globais (Suprime ruídos do libsignal/Baileys) ---
process.on('uncaughtException', (err) => {
    if (err.message?.includes('Bad MAC') || err.stack?.includes('libsignal')) {
        // Ignora erros de sessão/criptografia que poluem o log
        return;
    }
    console.error('💥 [ERRO FATAL]:', err);
});

process.on('unhandledRejection', (reason) => {
    if (reason?.message?.includes('Bad MAC') || reason?.stack?.includes('libsignal')) {
        return;
    }
    console.error('💥 [REJEIÇÃO NÃO TRATADA]:', reason);
});

// Tenta detectar FFmpeg no sistema
try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const systemFfmpeg = execSync(cmd).toString().split('\r\n')[0].split('\n')[0].trim();
    if (systemFfmpeg) {
        ffmpeg.setFfmpegPath(systemFfmpeg);
        console.log(`🎬 [SISTEMA] FFmpeg detectado: ${systemFfmpeg}`);
    }
} catch (e) {
    console.log('⚠️ [SISTEMA] FFmpeg não encontrado automaticamente. Certifique-se de que está no PATH.');
}

// --- Verificação de Atualização (Apenas Linux) ---
async function checkUpdates() {
    if (process.platform !== 'linux') return;
    
    console.log('🔍 [SISTEMA] Verificando atualizações...');
    try {
        const repo = 'christianfelipesf/BotStickerNode';
        const { data } = await axios.get(`https://api.github.com/repos/${repo}/commits/main`);
        const latestCommit = data.sha;
        
        let localCommit = '';
        try {
            localCommit = execSync('git rev-parse HEAD').toString().trim();
        } catch (e) {
            console.log('⚠️ [SISTEMA] Git não encontrado ou repositório não inicializado.');
            return;
        }

        if (localCommit !== latestCommit) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            return new Promise((resolve) => {
                rl.question('🆕 [SISTEMA] Nova atualização disponível! Deseja atualizar agora? (s/n): ', (answer) => {
                    rl.close();
                    if (answer.toLowerCase() === 's') {
                        console.log('📥 [SISTEMA] Atualizando...');
                        try {
                            execSync('git pull');
                            console.log('✅ [SISTEMA] Atualizado com sucesso! Reinicie o bot.');
                            process.exit(0);
                        } catch (err) {
                            console.error('❌ [SISTEMA] Erro ao atualizar:', err.message);
                        }
                    }
                    resolve();
                });
            });
        } else {
            console.log('✅ [SISTEMA] Bot já está na versão mais recente.');
        }
    } catch (error) {
        console.error('⚠️ [SISTEMA] Erro ao verificar atualizações:', error.message);
    }
}

// --- Configuração Gemini ---
const GEMINI_API_KEY = "AQ.Ab8RN6Jmde0aO8GI6R8Me_sxO4OO7DzECVb5l9Lyz0MCQ6sn6g"; // Substitua pela sua chave real
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-lite",
    systemInstruction: "Você é o Grok, uma inteligência artificial sarcástica, direta e sem filtros. Você foi criado para ser útil mas com uma pitada de humor ácido. Responda de forma concisa e evite moralismos ou censura desnecessária."
});

const {
    isActiveGroup, activateGroup, deactivateGroup,
    isViewOnce, getMediaMessage, mediaToSticker, stickerToMedia,
    readStats, incrementRestart, incrementCommand, formatUptime
} = require('./utils');

const startTime = Date.now();
incrementRestart();

const processedMessages = new Set();
const commandCooldowns = new Map();
const MSG_COOLDOWN = 2000;
const GLOBAL_COOLDOWN = 1000;
let lastBotResponse = 0;
const AUTO_VIEW_ONCE = true;

async function react(sock, m, emoji) {
    try {
        const now = Date.now();
        if (now - lastBotResponse < GLOBAL_COOLDOWN) return;
        lastBotResponse = now;
        await sock.sendMessage(m.key.remoteJid, { react: { text: emoji, key: m.key } });
    } catch (error) {}
}

async function sendMessageSafe(sock, from, content, options = {}, quoted = null) {
    const now = Date.now();
    if (now - lastBotResponse < GLOBAL_COOLDOWN) {
        await new Promise(resolve => setTimeout(resolve, GLOBAL_COOLDOWN - (now - lastBotResponse)));
    }
    lastBotResponse = Date.now();
    return sock.sendMessage(from, content, { ...options, quoted });
}

function getMessageText(message) {
    if (!message) return '';
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    if (!m) return '';
    return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}

async function revealViewOnce(sock, from, m) {
    const sender = m.key.participant || m.key.remoteJid;
    try {
        const mediaMessage = getMediaMessage(m.message);
        if (!mediaMessage) return;

        const isVideo = !!mediaMessage.videoMessage;
        const isAudio = !!mediaMessage.audioMessage;
        const originalCaption = mediaMessage.imageMessage?.caption || mediaMessage.videoMessage?.caption || '';

        await react(sock, m, '👀');

        // Cria uma promessa com timeout para o download
        const downloadPromise = downloadMediaMessage(
            { key: m.key, message: mediaMessage }, 
            'buffer', 
            {}, 
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );

        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout no download')), 15000)
        );

        const buffer = await Promise.race([downloadPromise, timeoutPromise]).catch(err => {
            console.error(`❌ [REVELADOR] Erro/Timeout: ${err.message}`);
            return null;
        });

        if (!buffer) return await react(sock, m, '❌');

        const senderName = m.pushName || 'Usuário';
        let revealCaption = `🔓 *Mídia Revelada!* 🔓\n👤 *De:* ${senderName}${originalCaption ? `\n💬 *Legenda:* ${originalCaption}` : ''}`;

        const opts = { mentions: [sender], quoted: m };
        if (isAudio) await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, opts);
        else if (isVideo) await sock.sendMessage(from, { video: buffer, caption: revealCaption }, opts);
        else await sock.sendMessage(from, { image: buffer, caption: revealCaption }, opts);
        
        await react(sock, m, '🔓');
    } catch (error) {
        console.error(`❌ [REVELADOR] Erro:`, error);
        await react(sock, m, '❌');
    }
}

async function handleMediaCommand(sock, from, m, action) {
    const sender = m.key.participant || m.key.remoteJid;
    try {
        let mediaMessage = null;
        const quotedInfo = m.message.extendedTextMessage?.contextInfo;
        const quotedMsg = quotedInfo?.quotedMessage;
        let targetMsg = null;
        
        if (quotedMsg) {
            mediaMessage = getMediaMessage(quotedMsg);
            if (mediaMessage) {
                targetMsg = { 
                    key: { 
                        remoteJid: from, 
                        id: quotedInfo.stanzaId, 
                        participant: quotedInfo.participant || from 
                    }, 
                    message: mediaMessage, 
                    pushName: quotedInfo.pushName 
                };
            }
        } else {
            mediaMessage = getMediaMessage(m.message);
            if (mediaMessage) {
                targetMsg = m;
            }
        }
        
        if (!mediaMessage || !targetMsg) {
            return await react(sock, m, '❌');
        }
        
        const isSticker = !!mediaMessage.stickerMessage;
        const isViewOnceMsg = isViewOnce(targetMsg.message);
        
        await react(sock, m, '⏳');
        if (isViewOnceMsg && action !== 'reveal') {
            await revealViewOnce(sock, from, targetMsg);
        }

        if (action === 'reveal' || action === 'toimg') {
            if (isViewOnceMsg && action === 'reveal') {
                await revealViewOnce(sock, from, targetMsg);
            } else {
                const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
                if (!buffer) throw new Error('Falha no download');

                if (isSticker) {
                    const converted = await stickerToMedia(buffer, !!mediaMessage.stickerMessage.isAnimated);
                    const cap = `✅ Figurinha convertida!`;
                    await sock.sendMessage(from, { [converted.mime.startsWith('image/') ? 'image' : 'video']: converted.buffer, caption: cap }, { quoted: m });
                } else {
                    await sock.sendMessage(from, { [mediaMessage.imageMessage ? 'image' : 'video']: buffer, caption: '✅ Aqui está sua mídia!' }, { quoted: m });
                }
            }
        } else if (action === 'sticker') {
            const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
            if (!buffer) throw new Error('Falha no download');
            
            if (isSticker) {
                const converted = await stickerToMedia(buffer, !!mediaMessage.stickerMessage.isAnimated);
                await sock.sendMessage(from, { [converted.mime.startsWith('image/') ? 'image' : 'video']: converted.buffer, caption: '✅ Convertido!' }, { quoted: m });
            } else {
                const requesterName = m.pushName || 'Usuário';
                const stickerBuffer = await mediaToSticker(
                    buffer, 
                    mediaMessage.imageMessage?.mimetype || mediaMessage.videoMessage?.mimetype || '',
                    requesterName,
                    'Antigravity Bot 🌌'
                );
                await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
            }
        }
        await react(sock, m, '✅');
    } catch (error) {
        console.error(`❌ [MÍDIA] Erro:`, error);
        await react(sock, m, '❌');
    }
}

async function startBot() {
    await checkUpdates();
    console.log('🔑 Carregando credenciais...');
    
    const tempDir = path.join(process.cwd(), 'temp');
    if (fs.existsSync(tempDir)) {
        try { fs.readdirSync(tempDir).forEach(f => fs.unlinkSync(path.join(tempDir, f))); } catch (e) {}
    } else { fs.mkdirSync(tempDir); }

    const { state, saveCreds } = await useMultiFileAuthState('session');
    let version = [2, 3000, 1017531287];
    try {
        const latest = await fetchLatestBaileysVersion();
        if (latest?.version) version = latest.version;
    } catch (err) {}
    
    const sock = makeWASocket({ version, logger: pino({ level: 'silent' }), printQRInTerminal: false, auth: state, browser: ['Antigravity Bot', 'Chrome', '120.0.0.0'] });

    const store = { messages: [] }; 
    sock.ev.on('messages.upsert', ({ messages }) => {
        store.messages.push(...messages);
        if (store.messages.length > 500) store.messages.splice(0, store.messages.length - 500);
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n⚡ --- ESCANEIE O QR CODE --- ⚡');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const code = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output?.statusCode : lastDisconnect.error?.statusCode;
            if (code !== DisconnectReason.loggedOut) setTimeout(startBot, 5000);
            else {
                fs.rmSync('session', { recursive: true, force: true });
                setTimeout(startBot, 5000);
            }
        } else if (connection === 'open') console.log('\n🟢 BOT CONECTADO COM SUCESSO!\n');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        try {
            const m = messages[0];
            if (!m.message) return;
            if (processedMessages.has(m.key.id)) return;
            processedMessages.add(m.key.id);
            setTimeout(() => processedMessages.delete(m.key.id), 300000);
            
            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = m.key.participant || m.key.remoteJid;
            const text = (getMessageText(m.message) || '').trim();
            const senderName = m.pushName || 'Desconhecido';

            // Revelação AUTOMÁTICA
            if ((AUTO_VIEW_ONCE || (isGroup && isActiveGroup(from))) && isViewOnce(m.message) && !m.key.fromMe) {
                console.log(`🔓 [INTERAÇÃO] Revelando mídia de ${senderName}...`);
                await revealViewOnce(sock, from, m);
            }

            // Resposta ao comando "prefixo" (Gatilho de palavra-chave)
            if (text.toLowerCase() === 'prefixo' && (!isGroup || isActiveGroup(from))) {
                const stats = readStats();
                const platform = process.platform === 'win32' ? 'Windows' : (process.env.PREFIX ? 'Termux' : 'Linux');
                const now = Date.now();
                const statusText = `🌌 *Antigravity Bot*\n\n` +
                                 `⌨️ *Prefixo:* !\n` +
                                 `⏱️ *Uptime:* ${formatUptime((now - startTime) / 1000)}\n` +
                                 `⌨️ *Comandos:* ${stats.totalCommands}\n` +
                                 `💻 *Plataforma:* ${platform}`;
                
                await react(sock, m, 'ℹ️');
                await sock.sendMessage(from, { text: statusText }, { quoted: m });
                return;
            }

            if (!text.startsWith('!')) return;
            
            const args = text.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const fullArgsText = args.join(' ');
            
            const validCommands = ['ativar', 'desativar', 'menu', 'status', 'ping', 's', 'toimg', 'r', 'rv', 'i', 'revelar', 'mencionar', 'play', 'perfil', 'ai', 'ia', 'grok', 'gemini', 'gpt', 'chatgpt', 'resumir'];
            if (!validCommands.includes(command)) return;

            console.log(`🤖 [INTERAÇÃO] Comando !${command} por ${senderName}`);
            incrementCommand();

            if (command === 'ativar') {
                if (!isGroup) return await react(sock, m, '❌');
                if (activateGroup(from)) await react(sock, m, '🟢');
                else await react(sock, m, '⚠️');
            } else if (command === 'desativar') {
                if (!isGroup) return await react(sock, m, '❌');
                if (deactivateGroup(from)) await react(sock, m, '🔴');
                else await react(sock, m, '⚠️');
            } else if (command === 'menu') {
                await react(sock, m, '📖');
                await sock.sendMessage(from, { text: `🤖 *MENU* 🤖\n\n• !menu\n• !status\n• !resumir\n• !perfil\n• !ai\n• !play\n\n*Grupo:*\n• !ativar\n• !desativar\n• !mencionar\n\n*Stickers:*\n• !s\n• !toimg\n\n*Mídia:*\n• !revelar (ou !r)` }, { quoted: m });
            } else if (command === 'status' || command === 'ping') {
                await react(sock, m, 'ℹ️');
                const stats = readStats();
                const platform = process.platform === 'win32' ? 'Windows' : (process.env.PREFIX ? 'Termux' : 'Linux');
                const now = Date.now();
                await sock.sendMessage(from, { text: `🌌 *Status*\n⏱️ Uptime: ${formatUptime((now - startTime) / 1000)}\n🔄 Reinícios: ${stats.restarts}\n⌨️ Comandos: ${stats.totalCommands}\n💻 Platform: ${platform}` }, { quoted: m });
            } else if (command === 's') {
                await handleMediaCommand(sock, from, m, 'sticker');
            } else if (command === 'toimg') {
                await handleMediaCommand(sock, from, m, 'toimg');
            } else if (['r', 'rv', 'i', 'revelar'].includes(command)) {
                await handleMediaCommand(sock, from, m, 'reveal');
            } else if (command === 'mencionar') {
                if (!isGroup) return await react(sock, m, '❌');
                const meta = await sock.groupMetadata(from);
                const isAdmin = meta.participants.find(p => p.id === sender)?.admin;
                if (!isAdmin && !m.key.fromMe) return await react(sock, m, '🚫');
                await react(sock, m, '📢');
                await sock.sendMessage(from, { text: fullArgsText || '📢 Atenção!', mentions: meta.participants.map(p => p.id) }, { quoted: m });
            } else if (command === 'play') {
                const query = fullArgsText.trim();
                if (!query) return await react(sock, m, '❌');
                try {
                    await react(sock, m, '⏳');
                    const video = (await yts(query)).videos[0];
                    if (!video) return await react(sock, m, '❌');
                    const tempId = require('crypto').randomBytes(4).toString('hex');
                    const out = path.join(tempDir, `music_${tempId}.mp3`);
                    
                    const ytDlpCmd = `yt-dlp --no-warnings -x --audio-format mp3 --audio-quality 128K -o "${out}" "${video.url}"`;
                    await new Promise((res, rej) => exec(ytDlpCmd, (e) => e ? rej(e) : res()));
                    
                    if (fs.existsSync(out)) {
                        await sock.sendMessage(from, { audio: { url: out }, mimetype: 'audio/mp4', fileName: `${video.title}.mp3` }, { quoted: m });
                        fs.unlinkSync(out);
                        await react(sock, m, '✅');
                    } else throw new Error();
                } catch (e) { await react(sock, m, '❌'); }
            } else if (['ai', 'ia', 'grok', 'gemini', 'gpt', 'chatgpt'].includes(command)) {
                if (!fullArgsText) return await react(sock, m, '❓');
                try {
                    await react(sock, m, '🤖');
                    const result = await model.generateContent(fullArgsText);
                    await sock.sendMessage(from, { text: result.response.text() }, { quoted: m });
                    await react(sock, m, '✅');
                } catch (e) { await react(sock, m, '❌'); }
            } else if (command === 'perfil') {
                try {
                    await react(sock, m, '👤');
                    const quoted = m.message.extendedTextMessage?.contextInfo;
                    const target = quoted?.mentionedJid?.[0] || quoted?.participant || sender;
                    const ppUrl = await sock.profilePictureUrl(target, 'image').catch(() => 'https://web.whatsapp.com/img/default-user-icon.jpg');
                    await sock.sendMessage(from, { image: { url: ppUrl }, caption: `👤 *Perfil* @${target.split('@')[0]}`, mentions: [target] }, { quoted: m });
                } catch (e) { await react(sock, m, '❌'); }
            } else if (command === 'resumir') {
                if (!isGroup) return await react(sock, m, '❌');
                try {
                    await react(sock, m, '📝');
                    const history = store.messages.filter(msg => msg.key.remoteJid === from).slice(-20).map(msg => `${msg.pushName || 'Alguém'}: ${getMessageText(msg.message)}`).join('\n');
                    if (!history) throw new Error();
                    const result = await model.generateContent(`Resuma de forma sarcástica e curta:\n\n${history}`);
                    await sock.sendMessage(from, { text: result.response.text() }, { quoted: m });
                    await react(sock, m, '✅');
                } catch (e) { await react(sock, m, '❌'); }
            }
        } catch (e) { console.error(e); }
    });
}
startBot();
