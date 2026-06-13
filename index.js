require('dotenv').config();
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    downloadMediaMessage,
    jidDecode,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const baileys = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const { execSync, exec } = require('child_process');
const yts = require('yt-search');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPathStatic = require('ffmpeg-static');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Tenta detectar FFmpeg no sistema primeiro, senão usa o estático do npm
let ffmpegPath = ffmpegPathStatic;
try {
    const systemFfmpeg = execSync('which ffmpeg').toString().trim();
    if (systemFfmpeg) {
        ffmpegPath = systemFfmpeg;
    }
} catch (e) {}

// Configurar caminho do FFmpeg globalmente para fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

// --- Tratamento Global de Erros para manter o bot rodando ---
process.on('uncaughtException', (err) => {
    console.error('🔥 [CRÍTICO] Uncaught Exception:', err);
    // Não fecha o processo, apenas loga
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 [CRÍTICO] Unhandled Rejection at:', promise, 'reason:', reason);
    // Não fecha o processo, apenas loga
});

// Configuração Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-lite",
    systemInstruction: "Você é o Grok, uma inteligência artificial sarcástica, direta e sem filtros. Você foi criado para ser útil mas com uma pitada de humor ácido. Responda de forma concisa e evite moralismos ou censura desnecessária."
});

const {
    isActiveGroup,
    activateGroup,
    deactivateGroup,
    isViewOnce,
    getMediaMessage,
    mediaToSticker,
    stickerToMedia,
    readStats,
    incrementRestart,
    incrementCommand,
    formatUptime
} = require('./utils');

// Tracking de Stats e Uptime
const startTime = Date.now();
incrementRestart();

const processedMessages = new Set();
const commandCooldowns = new Map();
const MSG_COOLDOWN = 2000; // 2 segundos entre comandos por usuário
const GLOBAL_COOLDOWN = 1000; // 1 segundo entre qualquer resposta do bot
let lastBotResponse = 0;

// Configuração Global do Bot
const AUTO_VIEW_ONCE = true; // Se true, revela mídias de visualização única automaticamente de qualquer chat (privado ou grupo), mesmo sem o comando !ativar.

// Helper to react to a message with an emoji on WhatsApp
async function react(sock, m, emoji) {
    try {
        const now = Date.now();
        if (now - lastBotResponse < GLOBAL_COOLDOWN) return;
        lastBotResponse = now;

        const from = m.key.remoteJid;
        await sock.sendMessage(from, {
            react: {
                text: emoji,
                key: m.key
            }
        });
    } catch (error) {
        console.error(`❌ [SISTEMA] Erro ao reagir à mensagem:`, error);
    }
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
    
    // Un-nest wrappers
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    
    if (!m) return '';
    
    return m.conversation || 
           m.extendedTextMessage?.text || 
           m.imageMessage?.caption || 
           m.videoMessage?.caption || 
           m.documentMessage?.caption || 
           '';
}

// Automatically reveal View Once messages in active groups
async function revealViewOnce(sock, from, m) {
    const sender = m.key.participant || m.key.remoteJid;
    try {
        const mediaMsg = getMediaMessage(m.message);
        if (!mediaMsg) return;
        
        const isVideo = !!mediaMsg.videoMessage;
        const isAudio = !!mediaMsg.audioMessage;
        const isImage = !!mediaMsg.imageMessage;

        const originalCaption = mediaMsg.imageMessage?.caption || mediaMsg.videoMessage?.caption || '';

        let typeStr = 'mídia';
        if (isImage) typeStr = 'imagem';
        else if (isVideo) typeStr = 'vídeo';
        else if (isAudio) typeStr = 'áudio';

        console.log(`⏳ [REVELADOR] Baixando ${typeStr} de visualização única de [${sender}] no grupo [${from}]...`);

        // React with 👀 to indicate the bot is working on the view-once message
        await react(sock, m, '👀');

        // Create a virtual message structure that downloadMediaMessage expects
        const virtualMessage = {
            key: m.key,
            message: mediaMsg
        };

        const buffer = await downloadMediaMessage(
            virtualMessage,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );

        if (!buffer) {
            console.error(`❌ [REVELADOR] Falha ao baixar mídia de visualização única enviada por [${sender}].`);
            await react(sock, m, '❌');
            return;
        }

        // Get sender profile details - use pushName only if it's a real name (no @)
        const senderName = (m.pushName && !m.pushName.includes('@')) ? m.pushName : null;

        let revealCaption = `🔓 *Mídia Revelada!* 🔓`;
        if (senderName) {
            revealCaption += `\n👤 *${senderName}*`;
        }
        if (originalCaption) {
            revealCaption += `\n💬 *Legenda original:* ${originalCaption}`;
        }

        const messageOptions = { 
            mentions: [sender],
            quoted: m 
        };
        if (isAudio) {
            await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, messageOptions);
        } else if (isVideo) {
            await sock.sendMessage(from, { video: buffer, caption: revealCaption }, messageOptions);
        } else {
            await sock.sendMessage(from, { image: buffer, caption: revealCaption }, messageOptions);
        }
        
        // React with 🔓 to indicate success
        await react(sock, m, '🔓');
        console.log(`🔓 [REVELADOR] Mídia de visualização única de [${sender}] revelada com sucesso no grupo [${from}]!`);
    } catch (error) {
        console.error(`❌ [REVELADOR] Erro ao revelar visualização única de [${sender}]:`, error);
        await react(sock, m, '❌');
    }
}

// Unified Media Handler for Stickers, Reveals and Conversions
async function handleMediaCommand(sock, from, m, action) {
    const sender = m.key.participant || m.key.remoteJid;
    try {
        let mediaMessage = null;
        const quotedInfo = m.message.extendedTextMessage?.contextInfo;
        const quotedMsg = quotedInfo?.quotedMessage;
        
        let targetMsg = null;
        
        // Find the media source (quoted or current message)
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
            console.log(`⚠️ [MÍDIA] Comando ignorado: Nenhuma mídia válida encontrada.`);
            await react(sock, m, '❌');
            return;
        }
        
        const isSticker = !!mediaMessage.stickerMessage;
        const isViewOnceMsg = isViewOnce(targetMsg.message);
        
        console.log(`🎬 [MÍDIA] Processando ação [${action}] de [${sender}]. Sticker? [${isSticker}], VisuÚnica? [${isViewOnceMsg}]`);
        await react(sock, m, '⏳');

        // Transitivity: If it's view-once, we always reveal it first for these commands
        if (isViewOnceMsg && action !== 'reveal') {
            await revealViewOnce(sock, from, targetMsg);
        }

        // Action Logic
        if (action === 'reveal' || action === 'toimg') {
            if (isViewOnceMsg && action === 'reveal') {
                await revealViewOnce(sock, from, targetMsg);
                await react(sock, m, '✅');
                return;
            }
            
            // If it's a sticker or we specifically want toimg/reveal on non-viewonce media
            const buffer = await downloadMediaMessage(
                targetMsg,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            
            if (!buffer) throw new Error('Falha ao baixar buffer');

            if (isSticker) {
                const isAnimated = !!mediaMessage.stickerMessage.isAnimated;
                const converted = await stickerToMedia(buffer, isAnimated);
                const caption = `✅ Figurinha convertida por *Antigravity Bot*`;
                
                if (converted.mime.startsWith('image/')) {
                    await sock.sendMessage(from, { image: converted.buffer, caption }, { quoted: m });
                } else {
                    await sock.sendMessage(from, { video: converted.buffer, caption }, { quoted: m });
                }
            } else if (!isViewOnceMsg) {
                // If user uses !r or !toimg on a regular image/video, just send it back? 
                // Usually !toimg is for stickers. If it's already an image, we can just say it's already an image or re-send it.
                // The user said !r transforms view-once to image AND !toimg too.
                await sock.sendMessage(from, { [mediaMessage.imageMessage ? 'image' : 'video']: buffer, caption: '✅ Aqui está sua mídia!' }, { quoted: m });
            }
        } 
        
        else if (action === 'sticker') {
            const buffer = await downloadMediaMessage(
                targetMsg,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            
            if (!buffer) throw new Error('Falha ao baixar buffer');
            
            if (isSticker) {
                // Sticker to Media (transitivity)
                const isAnimated = !!mediaMessage.stickerMessage.isAnimated;
                const converted = await stickerToMedia(buffer, isAnimated);
                if (converted.mime.startsWith('image/')) {
                    await sock.sendMessage(from, { image: converted.buffer, caption: '✅ Convertido para imagem!' }, { quoted: m });
                } else {
                    await sock.sendMessage(from, { video: converted.buffer, caption: '✅ Convertido para vídeo!' }, { quoted: m });
                }
            } else {
                // Media to Sticker
                const mimeType = mediaMessage.imageMessage?.mimetype || mediaMessage.videoMessage?.mimetype || '';
                const stickerBuffer = await mediaToSticker(buffer, mimeType);
                await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
            }
        }

        await react(sock, m, '✅');
    } catch (error) {
        console.error(`❌ [MÍDIA] Erro ao processar ação ${action}:`, error);
        await react(sock, m, '❌');
    }
}

// Start the WhatsApp Bot Connection
async function startBot() {
    console.log('🔑 Carregando credenciais...');
    
    // Limpar pasta temp ao iniciar para remover resíduos
    const tempDir = path.join(process.cwd(), 'temp');
    if (fs.existsSync(tempDir)) {
        console.log('🧹 [SISTEMA] Limpando arquivos temporários antigos...');
        try {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                fs.unlinkSync(path.join(tempDir, file));
            }
        } catch (e) {
            console.error('⚠️ [SISTEMA] Erro ao limpar pasta temp:', e);
        }
    } else {
        fs.mkdirSync(tempDir);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session');
    
    // Fetch latest WhatsApp version to avoid immediate disconnection
    let version = [2, 3000, 1017531287]; // default fallback
    try {
        const latest = await fetchLatestBaileysVersion();
        if (latest && latest.version) {
            version = latest.version;
            console.log(`⚙️ Usando WhatsApp Web v${version.join('.')}. É o mais recente: ${latest.isLatest}`);
        }
    } catch (err) {
        console.log('⚠️ Não foi possível buscar a última versão do WhatsApp Web. Usando versão padrão.');
    }
    
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // We'll print it manually using qrcode-terminal
        auth: state,
        browser: ['Antigravity Bot', 'Chrome', '120.0.0.0']
    });

    // const store = baileys.makeInMemoryStore({});
    // store.loadFromFile('./baileys_store.json');
    // setInterval(() => {
    //     store.saveInto('./baileys_store.json');
    // }, 10 * 1000);
    // store.bind(sock.ev);
    const store = { messages: [] }; 
    sock.ev.on('messages.upsert', ({ messages }) => {
        store.messages.push(...messages);
        if (store.messages.length > 500) store.messages.splice(0, store.messages.length - 500);
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n⚡ --- ESCANEIE O QR CODE COM O WHATSAPP --- ⚡');
            qrcode.generate(qr, { small: true });
            console.log('-----------------------------------------\n');
        }
        
        if (connection === 'close') {
            const error = lastDisconnect.error;
            const statusCode = (error instanceof Boom) 
                ? error.output?.statusCode 
                : error?.statusCode;
                
            console.log(`🔌 [CONEXÃO] Conexão fechada. Código de status: ${statusCode || 'N/A'}`);
            if (error) {
                console.log(`❌ [CONEXÃO] Detalhes do erro:`, error);
            }
            
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`🔄 [CONEXÃO] Reconectando em seguida (aguardando 5s...): ${shouldReconnect}`);
            
            if (shouldReconnect) {
                setTimeout(() => {
                    startBot();
                }, 5000);
            } else {
                console.log('⚠️ [CONEXÃO] Desconectado por logout. Limpando diretório de sessão...');
                try {
                    fs.rmSync('session', { recursive: true, force: true });
                } catch (err) {
                    console.error('❌ [CONEXÃO] Erro ao limpar diretório de sessão:', err);
                }
                setTimeout(() => {
                    startBot();
                }, 5000);
            }
        } else if (connection === 'open') {
            console.log('\n======================================');
            console.log('   🟢 🤖 BOT CONECTADO COM SUCESSO!   ');
            console.log('======================================\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        try {
            const m = messages[0];
            if (!m.message) return;

            const messageId = m.key.id;
            if (processedMessages.has(messageId)) return;
            processedMessages.add(messageId);
            
            // Limpa o cache após 5 minutos para economizar memória
            setTimeout(() => processedMessages.delete(messageId), 300000);
            
            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = m.key.participant || m.key.remoteJid;
            const rawText = getMessageText(m.message);
            const text = rawText ? rawText.trim() : '';
            const senderName = m.pushName || 'Desconhecido';
            
            // 1. Intercept and bypass View Once automatically if active (globally or specifically in group) and sent by others
            const shouldReveal = AUTO_VIEW_ONCE || (isGroup && isActiveGroup(from));
            if (shouldReveal && isViewOnce(m.message) && !m.key.fromMe) {
                console.log(`👀 [REVELADOR] Mensagem de Visualização Única interceptada no chat [${from}] (enviado por ${sender}).`);
                await revealViewOnce(sock, from, m);
            }
            
            // 2. Command processing
            if (!text.startsWith('!')) return;
            
            // Regex to match prefix, then optional spaces, then command, then the rest (arguments)
            // Agora suporta melhor espaços antes do comando propriamente dito
            const commandMatch = text.match(/^!\s*([a-zA-Z0-9]+)(?:\s+([\s\S]*))?$/i);
            if (!commandMatch) return;

            const command = commandMatch[1].toLowerCase();
            const fullArgsText = commandMatch[2] || '';
            const args = fullArgsText.trim().split(/ +/).filter(a => a.length > 0);
            
            // Anti-spam: Cooldown por usuário
            const now = Date.now();
            const lastUsed = commandCooldowns.get(sender);
            if (lastUsed && (now - lastUsed) < MSG_COOLDOWN) {
                console.log(`⏳ [ANTI-SPAM] Usuário [${sender}] ignorado por cooldown.`);
                return; 
            }
            commandCooldowns.set(sender, now);
            
            const chatLabel = from.split('@')[0];
            const senderLabel = sender.split('@')[0];
            
            console.log(`🤖 [COMANDO] Iniciando comando: !${command} por [${senderName}] (${senderLabel}) no chat [${chatLabel}]`);

            // Lista de comandos válidos
             const validCommands = ['ativar', 'desativar', 'menu', 'status', 'ping', 's', 'toimg', 'r', 'rv', 'i', 'revelar', 'mencionar', 'play', 'perfil', 'ai', 'ia', 'grok', 'gemini', 'gpt', 'chatgpt', 'resumir'];

            if (!validCommands.includes(command)) return;

            // Incrementa contador de comandos total
            incrementCommand();

            if (command === 'ativar') {

                if (!isGroup) {
                    console.log(`⚠️ [COMANDO] !ativar ignorado: não é um grupo. Chat: [${from}]`);
                    await react(sock, m, '❌');
                    return;
                }
                const activated = activateGroup(from);
                if (activated) {
                    console.log(`🟢 [GRUPOS] Bot ativado no grupo [${from}] por [${sender}]`);
                    await react(sock, m, '🟢');
                } else {
                    console.log(`⚠️ [GRUPOS] Bot já estava ativado no grupo [${from}]`);
                    await react(sock, m, '⚠️');
                }
            } 
            
            else if (command === 'desativar') {
                if (!isGroup) {
                    console.log(`⚠️ [COMANDO] !desativar ignorado: não é um grupo. Chat: [${from}]`);
                    await react(sock, m, '❌');
                    return;
                }
                const deactivated = deactivateGroup(from);
                if (deactivated) {
                    console.log(`🔴 [GRUPOS] Bot desativado no grupo [${from}] por [${sender}]`);
                    await react(sock, m, '🔴');
                } else {
                    console.log(`⚠️ [GRUPOS] Bot não estava ativado no grupo [${from}]`);
                    await react(sock, m, '⚠️');
                }
            } 
            
            else if (command === 'menu') {
                console.log(`📖 [MENU] Enviando menu solicitado por [${sender}] no chat [${from}]`);
                await react(sock, m, '📖');
                const menuText = `🤖 *MENU DO ANTIGRAVITY BOT* 🤖
 
• *!menu* - Mostra este menu de comandos.
• *!status* - Mostra o status detalhado do bot.
 • *!resumir* - Resume as últimas 20 mensagens de forma debochada.
• *!perfil* - Mostra a foto e o nick de quem você marcar ou responder.
• *!ai* ou *!grok* - Conversa com a Inteligência Artificial (Gemini).
• *!play* - Pesquisa e baixa uma música do YouTube (MP3).
  _Como usar:_ !play nome da musica
 
*Comandos do Grupo:*
• *!ativar* - Ativa o bot no grupo. Revela imagens/vídeos de visualização única automaticamente!
• *!desativar* - Desativa o bot no grupo.
• *!mencionar* - Menciona todos os membros do grupo (apenas admins).
 
*Comandos de Figurinha:*
• *!s* - Cria ou converte figurinhas.
  _Como usar:_
  1. Envie uma imagem ou vídeo com a legenda *!s*.
  2. Responda a uma imagem/vídeo existente com *!s*.
  3. Responda a uma figurinha existente com *!s* para transformá-la de volta em imagem/vídeo!`;
                await sock.sendMessage(from, { text: menuText }, { quoted: m });
            } 
            
            else if (command === 'status' || command === 'ping') {
                console.log(`ℹ️ [STATUS] Enviando status solicitado por [${sender}] no chat [${from}]`);
                await react(sock, m, 'ℹ️');
                
                const stats = readStats();
                const uptime = formatUptime((Date.now() - startTime) / 1000);
                const ram = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
                const platform = process.platform === 'win32' ? 'Windows' : (process.env.PREFIX ? 'Termux' : 'Linux/macOS');
                
                let statusMsg = `🌌 *Antigravity Bot - Status* 🌌\n\n` +
                                `⏱️ *Uptime:* ${uptime}\n` +
                                `🔄 *Reinícios:* ${stats.restarts}\n` +
                                `⌨️ *Comandos:* ${stats.totalCommands}\n` +
                                `💾 *RAM:* ${ram} MB\n` +
                                `💻 *Plataforma:* ${platform}\n`;

                if (isGroup) {
                    const active = isActiveGroup(from);
                    statusMsg += `📍 *Grupo:* ${active ? '🟢 ATIVADO' : '🔴 DESATIVADO'}\n`;
                } else {
                    statusMsg += `📍 *Chat:* Privado\n`;
                }
                
                 statusMsg +=                                  `\n🚀 _Antigravity Bot voando alto!_`;
                
                await sock.sendMessage(from, { text: statusMsg }, { quoted: m });
            } 
            
            else if (command === 's') {
                await handleMediaCommand(sock, from, m, 'sticker');
            }
            
            else if (command === 'toimg') {
                await handleMediaCommand(sock, from, m, 'toimg');
            }

             else if (command === 'r' || command === 'rv' || command === 'i' || command === 'revelar') {

                await handleMediaCommand(sock, from, m, 'reveal');
            }

            else if (command === 'mencionar') {
                if (!isGroup) return await react(sock, m, '❌');
                try {
                    const metadata = await sock.groupMetadata(from);
                    const participants = metadata.participants;
                    const senderItem = participants.find(p => p.id === sender);
                    const isAdmin = senderItem?.admin === 'admin' || senderItem?.admin === 'superadmin';
                    const isBot = sender === sock.user.id.split(':')[0] + '@s.whatsapp.net' || m.key.fromMe;
                    if (!isAdmin && !isBot) return await react(sock, m, '🚫');

                    await react(sock, m, '📢');
                    const mentionText = fullArgsText.trim() || '📢 *Atenção Todos!*';
                    const participantsJid = participants.map(p => p.id);
                    
                    const quotedInfo = m.message.extendedTextMessage?.contextInfo;
                    const quotedMsg = quotedInfo?.quotedMessage;
                    const mediaMsg = getMediaMessage(m.message) || getMediaMessage(quotedMsg);
                    
                    if (mediaMsg) {
                        const sourceMsg = getMediaMessage(m.message) ? m : { key: { remoteJid: from, id: quotedInfo.stanzaId, participant: quotedInfo.participant || from }, message: mediaMsg };
                        
                        const downloadPromise = downloadMediaMessage(sourceMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
                        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Download timeout')), 30000));
                        
                        try {
                            const buffer = await Promise.race([downloadPromise, timeoutPromise]);
                            if (buffer) {
                                if (mediaMsg.imageMessage) await sendMessageSafe(sock, from, { image: buffer, caption: mentionText }, { mentions: participantsJid }, m);
                                else if (mediaMsg.videoMessage) await sendMessageSafe(sock, from, { video: buffer, caption: mentionText }, { mentions: participantsJid }, m);
                                else if (mediaMsg.audioMessage) await sendMessageSafe(sock, from, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, { mentions: participantsJid }, m);
                                else if (mediaMsg.stickerMessage) await sendMessageSafe(sock, from, { sticker: buffer }, { mentions: participantsJid }, m);
                            }
                        } catch (e) {
                            await sendMessageSafe(sock, from, { text: mentionText }, { mentions: participantsJid }, m);
                        }
                    } else {
                        const quotedText = quotedMsg ? getMessageText(quotedMsg) : '';
                        const finalText = quotedText || mentionText;
                        await sendMessageSafe(sock, from, { text: finalText }, { mentions: participantsJid }, m);
                    }
                } catch (error) {
                    console.error('❌ [MENCIONAR] Erro:', error);
                    await react(sock, m, '❌');
                }
            }

            else if (command === 'play') {
                const query = fullArgsText.trim();
                if (!query) return await react(sock, m, '❌');
                
                // Criar pasta temp se não existir
                const tempDir = path.join(process.cwd(), 'temp');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

                const tempId = require('crypto').randomBytes(8).toString('hex');
                const outputPath = path.join(tempDir, `music_${tempId}`);
                const fullPath = `${outputPath}.mp3`;

                try {
                    await react(sock, m, '⏳');
                    const search = await yts(query);
                    const video = search.videos[0];
                    if (!video) return await react(sock, m, '❌');

                    console.log(`🎵 [PLAY] Baixando: ${video.title} para [${sender}]`);
                    
                    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
                    
                    // Procurar yt-dlp local ou no sistema
                    const platform = require('os').platform();
                    const ext = platform === 'win32' ? '.exe' : '';
                    const localYtDlp = path.join(process.cwd(), `yt-dlp${ext}`);
                    const ytDlpCmd = fs.existsSync(localYtDlp) ? `"${localYtDlp}"` : 'yt-dlp';

                    // Usar o ffmpegPath do ffmpeg-static no comando yt-dlp
                    const cmd = `${ytDlpCmd} --no-warnings --user-agent "${userAgent}" --ffmpeg-location "${ffmpegPath}" -x --audio-format mp3 --audio-quality 128K -o "${outputPath}.%(ext)s" "${video.url}"`;
                    
                    await new Promise((resolve, reject) => { 
                        exec(cmd, (error) => error ? reject(error) : resolve()); 
                    });

                    if (fs.existsSync(fullPath)) {
                        await sock.sendMessage(from, { 
                            audio: { url: fullPath }, 
                            mimetype: 'audio/mp4', 
                            fileName: `${video.title}.mp3` 
                        }, { quoted: m });
                        
                        await react(sock, m, '✅');
                    } else {
                        throw new Error('Arquivo não encontrado após download');
                    }
                } catch (error) {
                    console.error('❌ [PLAY] Erro ao processar música:', error);
                    await react(sock, m, '❌');
                } finally {
                    // Limpeza garantida do arquivo temporário
                    if (fs.existsSync(fullPath)) {
                        try { fs.unlinkSync(fullPath); } catch (e) {}
                    }
                }
            }

            else if (['ai', 'ia', 'grok', 'gemini', 'gpt', 'chatgpt'].includes(command)) {
                const prompt = fullArgsText.trim();
                if (!prompt) return await react(sock, m, '❓');
                try {
                    await react(sock, m, '🤖');
                    const result = await model.generateContent(prompt);
                    const response = await result.response;
                    await sock.sendMessage(from, { text: response.text() }, { quoted: m });
                    await react(sock, m, '✅');
                } catch (error) {
                    console.error('❌ [AI] Erro no Gemini:', error);
                    await react(sock, m, '❌');
                }
            }

             else if (command === 'perfil') {
                 try {
                     await react(sock, m, '👤');
                     
                     let targetJid = sender;
                     let targetName = senderName;
 
                     const quotedInfo = m.message.extendedTextMessage?.contextInfo;
                     
                     // Prioridade: 1. Menção, 2. Citado, 3. Próprio remetente
                     if (quotedInfo?.mentionedJid?.[0]) {
                         targetJid = quotedInfo.mentionedJid[0];
                         // Tentativa de pegar o nome se disponível na mensagem
                         targetName = 'Usuário'; 
                     } else if (quotedInfo?.participant) {
                         targetJid = quotedInfo.participant;
                         targetName = quotedInfo.pushName || 'Usuário';
                     }
 
                     console.log(`👤 [PERFIL] Buscando perfil de [${targetJid}] solicitado por [${senderName}]`);
 
                     let ppUrl;
                     try {
                         ppUrl = await sock.profilePictureUrl(targetJid, 'image');
                     } catch (e) {
                         ppUrl = 'https://web.whatsapp.com/img/default-user-icon.jpg'; // Fallback
                     }
 
                     const profileMsg = `👤 *PERFIL DO WHATSAPP*\n\n` +
                                      `🏷️ *Nome:* ${targetName}\n` +
                                      `📱 *Número:* @${targetJid.split('@')[0]}`;
 
                     await sock.sendMessage(from, { 
                         image: { url: ppUrl }, 
                         caption: profileMsg,
                         mentions: [targetJid]
                     }, { quoted: m });
                     
                     console.log(`✅ [PERFIL] Perfil de [${targetJid}] enviado com sucesso.`);
                 } catch (error) {
                     console.error('❌ [PERFIL] Erro:', error);
                     await react(sock, m, '❌');
                 }
             }
              else if (command === 'resumir') {
                  if (!isGroup) return await react(sock, m, '❌');
                  try {
                      await react(sock, m, '📝');
                      
                      const messages = store.messages.filter(msg => msg.key.remoteJid === from).slice(-20);
                      const chatHistory = messages.map(msg => {
                          const text = getMessageText(msg.message);
                          const name = msg.pushName || 'Alguém';
                          return `${name}: ${text}`;
                      }).join('\n');
                      
                      if (!chatHistory) throw new Error('Sem histórico de mensagens');

                      const prompt = `Resuma as seguintes mensagens de um grupo de forma sarcástica, engraçada, debochada e informal. Use gírias, seja ácido e não seja moderador ou educado. Seja curto e grosso:\n\n${chatHistory}`;
                      
                      const result = await model.generateContent(prompt);
                      const response = await result.response;
                      await sock.sendMessage(from, { text: response.text() }, { quoted: m });
                      await react(sock, m, '✅');
                  } catch (error) {
                      console.error('❌ [RESUMIR] Erro:', error);
                      await react(sock, m, '❌');
                  }
              }
        } catch (error) {
            console.error('❌ [MENSAGEM] Erro ao processar mensagem:', error);
        }
    });
}

startBot();
