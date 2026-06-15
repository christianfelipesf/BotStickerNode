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

const {
    isActiveGroup, activateGroup, deactivateGroup,
    isViewOnce, getMediaMessage, mediaToSticker, stickerToMedia,
    readStats, incrementRestart, incrementCommand, formatUptime,
    readConfig, writeConfig, saveMessage, getChatHistory,
    changeSpeed
} = require('./utils');

// --- Configuração Global ---
let config = readConfig();
let model;

function setupAI() {
    if (!config.geminiApiKey) return;
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    model = genAI.getGenerativeModel({ 
        model: config.geminiModel || "gemini-1.5-flash",
        systemInstruction: `Você é o ${config.botName}, uma inteligência artificial sarcástica, direta e sem filtros. Você foi criado para ser útil mas com uma pitada de humor ácido. Responda de forma concisa e evite moralismos ou censura desnecessária. Use emojis para dar personalidade às respostas.`
    });
}
setupAI();

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

async function react(sock, m, emoji) {
    try {
        const now = Date.now();
        if (now - lastBotResponse < GLOBAL_COOLDOWN) return;
        lastBotResponse = now;
        await sock.sendMessage(m.key.remoteJid, { react: { text: emoji, key: m.key } });
    } catch (error) {}
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
        const buffer = await downloadMediaMessage({ key: m.key, message: mediaMessage }, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }).catch(() => null);
        if (!buffer) return await react(sock, m, '❌');
        const senderName = m.pushName || 'Usuário';
        let revealCaption = `🔓 *Mídia Revelada!* 🔓\n👤 *De:* ${senderName}${originalCaption ? `\n💬 *Legenda:* ${originalCaption}` : ''}`;
        const opts = { mentions: [sender], quoted: m };
        if (isAudio) await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, opts);
        else if (isVideo) await sock.sendMessage(from, { video: buffer, caption: revealCaption }, opts);
        else await sock.sendMessage(from, { image: buffer, caption: revealCaption }, opts);
        await react(sock, m, '🔓');
    } catch (error) { await react(sock, m, '❌'); }
}

async function handleMediaCommand(sock, from, m, action, speed = 1.0) {
    try {
        let mediaMessage = null;
        const quotedInfo = m.message.extendedTextMessage?.contextInfo;
        const quotedMsg = quotedInfo?.quotedMessage;
        let targetMsg = null;
        if (quotedMsg) {
            mediaMessage = getMediaMessage(quotedMsg);
            if (mediaMessage) targetMsg = { key: { remoteJid: from, id: quotedInfo.stanzaId, participant: quotedInfo.participant || from }, message: mediaMessage, pushName: quotedInfo.pushName };
        } else {
            mediaMessage = getMediaMessage(m.message);
            if (mediaMessage) targetMsg = m;
        }
        if (!mediaMessage || !targetMsg) return await react(sock, m, '❌');
        
        const isSticker = !!mediaMessage.stickerMessage;
        const isViewOnceMsg = isViewOnce(targetMsg.message);
        await react(sock, m, '⏳');

        if (isViewOnceMsg && action !== 'reveal') await revealViewOnce(sock, from, targetMsg);

        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
        if (!buffer) throw new Error();

        if (action === 'reveal' || action === 'toimg') {
            if (isViewOnceMsg && action === 'reveal') return; // Já revelado
            if (isSticker) {
                const converted = await stickerToMedia(buffer, !!mediaMessage.stickerMessage.isAnimated);
                await sock.sendMessage(from, { [converted.mime.startsWith('image/') ? 'image' : 'video']: converted.buffer, caption: `✅ Convertido!` }, { quoted: m });
            } else {
                await sock.sendMessage(from, { [mediaMessage.imageMessage ? 'image' : 'video']: buffer, caption: '✅ Aqui está sua mídia!' }, { quoted: m });
            }
        } else if (action === 'sticker') {
            if (isSticker) {
                const converted = await stickerToMedia(buffer, !!mediaMessage.stickerMessage.isAnimated);
                await sock.sendMessage(from, { [converted.mime.startsWith('image/') ? 'image' : 'video']: converted.buffer, caption: '✅ Convertido!' }, { quoted: m });
            } else {
                const requesterName = m.pushName || 'Usuário';
                const stickerBuffer = await mediaToSticker(buffer, mediaMessage.imageMessage?.mimetype || mediaMessage.videoMessage?.mimetype || '', requesterName, `${config.botName} 🌌`);
                await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
            }
        } else if (action === 'speed') {
            if (!mediaMessage.videoMessage && !mediaMessage.audioMessage) return await sock.sendMessage(from, { text: '❌ Marque um vídeo ou áudio.' }, { quoted: m });
            const processed = await changeSpeed(buffer, mediaMessage.videoMessage ? 'video/mp4' : 'audio/mp4', speed);
            if (mediaMessage.videoMessage) await sock.sendMessage(from, { video: processed, caption: `✅ Vídeo ${speed}x` }, { quoted: m });
            else await sock.sendMessage(from, { audio: processed, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: m });
        }
        await react(sock, m, '✅');
    } catch (error) { await react(sock, m, '❌'); }
}

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
            if ((AUTO_VIEW_ONCE || (isGroup && isActiveGroup(from))) && isViewOnce(m.message) && !m.key.fromMe) await revealViewOnce(sock, from, m);

            if (text.toLowerCase() === 'prefixo' && (!isGroup || isActiveGroup(from))) {
                const stats = readStats();
                const now = Date.now();
                const statusText = `🌌 *${config.botName}*\n\n⌨️ *Prefixo:* ${config.prefix}\n⏱️ *Uptime:* ${formatUptime((now - startTime) / 1000)}\n⌨️ *Comandos:* ${stats.totalCommands}\n💻 *Plataforma:* ${process.platform === 'win32' ? 'Windows' : 'Linux'}`;
                await react(sock, m, 'ℹ️');
                return await sock.sendMessage(from, { text: statusText }, { quoted: m });
            }

            if (!text.startsWith(config.prefix)) return;
            const args = text.slice(config.prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const fullArgsText = args.join(' ');
            const validCommands = ['ativar', 'desativar', 'menu', 'status', 'ping', 's', 'toimg', 'r', 'rv', 'i', 'revelar', 'mencionar', 'play', 'perfil', 'ai', 'ia', 'grok', 'gemini', 'gpt', 'chatgpt', 'resumir', 'resumo', 'resuma', 'config', 'set', 'acelerar', 'desacelerar'];
            if (!validCommands.includes(command)) return;

            console.log(`🤖 [INTERAÇÃO] Comando ${config.prefix}${command} por ${senderName} em ${from}`);
            incrementCommand();

            switch(command) {
                case 'ativar':
                    if (!isGroup) return await react(sock, m, '❌');
                    await react(sock, m, activateGroup(from) ? '🟢' : '⚠️');
                    break;
                case 'desativar':
                    if (!isGroup) return await react(sock, m, '❌');
                    await react(sock, m, deactivateGroup(from) ? '🔴' : '⚠️');
                    break;
                case 'menu':
                    await react(sock, m, '📖');
                    const menuText = `✨ *${config.botName}* ✨\n\n╭─── *GERAL* ───\n│ 📂 *${config.prefix}menu*\n│ 📊 *${config.prefix}status*\n│ 👤 *${config.prefix}perfil*\n│ 🤖 *${config.prefix}ia* <texto>\n╰───────────────\n\n╭─── *MÍDIA* ───\n│ 🖼️ *${config.prefix}s* (sticker)\n│ 🔄 *${config.prefix}toimg*\n│ 🔓 *${config.prefix}revelar*\n│ 🎵 *${config.prefix}play* <nome>\n│ ⚡ *${config.prefix}acelerar*\n│ 🐌 *${config.prefix}desacelerar*\n╰───────────────\n\n╭─── *GRUPOS* ───\n│ ✅ *${config.prefix}ativar*\n│ ❌ *${config.prefix}desativar*\n│ 📢 *${config.prefix}mencionar*\n│ 📝 *${config.prefix}resumir*\n╰───────────────`;
                    if (config.showLogoInMenu && fs.existsSync('./logo.png')) await sock.sendMessage(from, { image: { url: './logo.png' }, caption: menuText }, { quoted: m });
                    else await sock.sendMessage(from, { text: menuText }, { quoted: m });
                    break;
                case 'status': case 'ping':
                    await react(sock, m, 'ℹ️');
                    const stats = readStats();
                    await sock.sendMessage(from, { text: `🌌 *${config.botName} - Status*\n⏱️ Uptime: ${formatUptime((now - startTime) / 1000)}\n🔄 Reinícios: ${stats.restarts}\n⌨️ Comandos: ${stats.totalCommands}\n💻 Platform: ${process.platform === 'win32' ? 'Windows' : 'Linux'}` }, { quoted: m });
                    break;
                case 'config':
                    const cfgTxt = `⚙️ *CONFIGURAÇÕES*\n\n🤖 *Nome:* ${config.botName}\n⌨️ *Prefixo:* ${config.prefix}\n🖼️ *Logo Menu:* ${config.showLogoInMenu ? 'Sim' : 'Não'}\n🎙️ *Efeitos Voz:* ${config.voiceEffects ? 'Sim' : 'Não'}\n📝 *Limite Resumo:* ${config.summaryLimit}\n📦 *Pack:* ${config.stickerPack}\n👤 *Autor:* ${config.stickerAuthor}\n\n*Mudar:* ${config.prefix}set <parâmetro> <valor>`;
                    await sock.sendMessage(from, { text: cfgTxt }, { quoted: m });
                    break;
                case 'set':
                    const p = args[0]; const v = args.slice(1).join(' ');
                    if (!p || !v) return await sock.sendMessage(from, { text: `❌ Use: ${config.prefix}set <parâmetro> <valor>` }, { quoted: m });
                    if (config[p] !== undefined) {
                        config[p] = (p === 'showLogoInMenu' || p === 'voiceEffects') ? v.toLowerCase() === 'true' : (p === 'summaryLimit' ? parseInt(v) : v);
                        writeConfig(config); config = readConfig(); setupAI(); await react(sock, m, '✅');
                        await sock.sendMessage(from, { text: `✅ *${p}* atualizado!` }, { quoted: m });
                    } else await sock.sendMessage(from, { text: `❌ Parâmetro inválido!` }, { quoted: m });
                    break;
                case 's': await handleMediaCommand(sock, from, m, 'sticker'); break;
                case 'toimg': await handleMediaCommand(sock, from, m, 'toimg'); break;
                case 'r': case 'rv': case 'i': case 'revelar': await handleMediaCommand(sock, from, m, 'reveal'); break;
                case 'acelerar': await handleMediaCommand(sock, from, m, 'speed', 2.0); break;
                case 'desacelerar': await handleMediaCommand(sock, from, m, 'speed', 0.5); break;
                case 'mencionar':
                    if (!isGroup) return await react(sock, m, '❌');
                    const meta = await sock.groupMetadata(from);
                    if (!meta.participants.find(p => p.id === sender)?.admin && !m.key.fromMe) return await react(sock, m, '🚫');
                    await react(sock, m, '📢');
                    await sock.sendMessage(from, { text: fullArgsText || '📢 Atenção!', mentions: meta.participants.map(p => p.id) }, { quoted: m });
                    break;
                case 'play':
                    const q = fullArgsText.trim(); if (!q) return await react(sock, m, '❌');
                    try {
                        await react(sock, m, '⏳'); const video = (await yts(q)).videos[0]; if (!video) throw new Error();
                        const out = path.join('temp', `music_${crypto.randomBytes(4).toString('hex')}.mp3`);
                        await new Promise((res, rej) => exec(`yt-dlp --no-warnings -x --audio-format mp3 --audio-quality 128K -o "${out}" "${video.url}"`, (e) => e ? rej(e) : res()));
                        if (fs.existsSync(out)) { await sock.sendMessage(from, { audio: { url: out }, mimetype: 'audio/mp4', fileName: `${video.title}.mp3` }, { quoted: m }); fs.unlinkSync(out); await react(sock, m, '✅'); }
                    } catch (e) { await react(sock, m, '❌'); }
                    break;
                case 'perfil':
                    try {
                        await react(sock, m, '👤'); const qInfo = m.message.extendedTextMessage?.contextInfo;
                        const target = qInfo?.mentionedJid?.[0] || qInfo?.participant || sender;
                        const ppUrl = await sock.profilePictureUrl(target, 'image').catch(() => 'https://web.whatsapp.com/img/default-user-icon.jpg');
                        await sock.sendMessage(from, { image: { url: ppUrl }, caption: `👤 *Perfil* @${target.split('@')[0]}`, mentions: [target] }, { quoted: m });
                    } catch (e) { await react(sock, m, '❌'); }
                    break;
                case 'ai': case 'ia': case 'grok': case 'gemini': case 'gpt': case 'chatgpt':
                    if (!model) return await sock.sendMessage(from, { text: '❌ IA não configurada. Defina a geminiApiKey.' }, { quoted: m });
                    if (!fullArgsText) return await react(sock, m, '❓');
                    try {
                        await react(sock, m, '🤖'); const result = await model.generateContent(fullArgsText);
                        await sock.sendMessage(from, { text: result.response.text() }, { quoted: m }); await react(sock, m, '✅');
                    } catch (e) { 
                        console.error('❌ [IA] Erro:', e);
                        await sock.sendMessage(from, { text: '❌ Comandos de IA indisponíveis no momento.' }, { quoted: m });
                    }
                    break;
                case 'resumir': case 'resumo': case 'resuma':
                    if (!isGroup || !model) return await react(sock, m, '❌');
                    try {
                        await react(sock, m, '📝');
                        const h = getChatHistory(from, config.summaryLimit || 20).map(msg => {
                            const time = new Date(msg.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                            return `[${time}] ${msg.pushName}: ${msg.text}`;
                        }).join('\n');
                        if (!h) return await sock.sendMessage(from, { text: '❌ Sem mensagens suficientes.' }, { quoted: m });
                        const res = await model.generateContent(`Resuma as seguintes mensagens de um chat de WhatsApp de forma sarcástica, curta e direta. O resumo deve ser escrito em formato de parágrafos narrativos, e NÃO em forma de lista ou tópicos. É OBRIGATÓRIO mencionar os nomes dos participantes para explicar quem disse o quê no contexto da conversa:\n\n${h}`);
                        await sock.sendMessage(from, { text: res.response.text() }, { quoted: m }); await react(sock, m, '✅');
                    } catch (e) { await sock.sendMessage(from, { text: '❌ Falha ao resumir.' }, { quoted: m }); }
                    break;
            }
        } catch (e) {}
    });
}
startBot();
