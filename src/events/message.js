const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { revealViewOnce } = require('./media');
const { getModel } = require('../services/ai');
const dashboard = require('../dashboard/dashboard');

const {
    isActiveGroup, activateGroup, deactivateGroup,
    getGroupData, setGroupData, saveGroupMenuImage,
    isViewOnce, getMediaMessage, getContextInfo, mediaToSticker, stickerToMedia,
    readStats, incrementCommand, formatUptime,
    readConfig, writeConfig, saveMessage, getChatHistory,
    changeSpeed, getBotName, react, getMessageText,
    isDashboardEnabled, listDashboardGroups, setDashboardEnabled
} = require('../database/utils');

const dashboardCacheMedia = dashboard.cacheMedia;
const dashboardPushGroups = dashboard.pushGroupsSnapshot;
const dashboardRememberGroup = dashboard.rememberGroupInfo;

const safeDashboardLog = (...args) => { try { dashboard.log(...args); } catch (_) {} };
const safeDashboardCache = (...args) => { try { dashboardCacheMedia(...args); } catch (_) {} };
const safeDashboardRememberGroup = (...args) => { try { dashboardRememberGroup(...args); } catch (_) {} };

const processedMessages = new Set();
// Limpa periodicamente para evitar crescimento infinito da memória
setInterval(() => processedMessages.clear(), 10 * 60 * 1000);

const GLOBAL_COOLDOWN = 1000;
let lastBotResponse = 0;
const AUTO_VIEW_ONCE = true;

module.exports = {
    handleMessageUpsert: async (sock, { messages, type }, { commands, config, startTime }) => {
        if (type !== 'notify' && !messages?.some(msg => msg?.key?.fromMe)) return;
        try {
            const m = messages[0];
            if (!m.message || processedMessages.has(m.key.id)) return;
            
            const messageTime = m.messageTimestamp?.low || m.messageTimestamp || 0;
            const bootThreshold = Math.floor(startTime / 1000) + 10;
            if (messageTime < bootThreshold) return;

            processedMessages.add(m.key.id);
            
            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = m.key.fromMe
                ? (sock.user?.id || m.key.participant || m.key.remoteJid)
                : (m.key.participant || m.key.remoteJid);
            const text = (getMessageText(m.message) || '').trim();
            const senderName = m.key.fromMe
                ? config.botName
                : (m.pushName || 'Usuário');

            // Tratamento especial para Reações (para evitar bolhas vazias e poluição no chat do dashboard)
            const reactionMsg = m.message?.reactionMessage || m.message?.ephemeralMessage?.message?.reactionMessage;
            if (reactionMsg) {
                if (isGroup && isDashboardEnabled(from)) {
                    const targetId = reactionMsg.key.id;
                    const emoji = reactionMsg.text || '';
                    const { handleReaction } = require('../dashboard/dashboard');
                    handleReaction(targetId, emoji, sender, senderName);
                }
                return;
            }

            // Tratamento especial para Protocolos (como mensagens apagadas)
            const protocolMsg = m.message?.protocolMessage || m.message?.ephemeralMessage?.message?.protocolMessage;
            if (protocolMsg) {
                if (protocolMsg.type === 3 && isGroup && isDashboardEnabled(from)) {
                    const groupMetadata = await sock.groupMetadata(from).catch(() => ({ subject: 'Grupo' }));
                    safeDashboardRememberGroup(from, { subject: groupMetadata.subject });
                    
                    safeDashboardLog('chat',
                        groupMetadata.subject,
                        '📑 [Apagou uma mensagem]',
                        senderName,
                        sender.split('@')[0],
                        null,
                        {
                            toJid: from,
                            messageId: m.key.id,
                            senderJid: sender,
                            fromMe: !!m.key.fromMe,
                            ephemeral: !!m.message?.ephemeralMessage
                        }
                    );
                }
                return;
            }

            const isBotActive = !isGroup || isActiveGroup(from);
            
            // --- Enforce Admin Policies (Mute & Anti-Link) ---
            if (isGroup && isBotActive) {
                const groupData = getGroupData(from);
                const utilsRef = require('../database/utils');
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

            // Log no Dashboard (Apenas com dashboard opt-in - independente de o bot estar ativo ou não no grupo)
            if (isGroup && isDashboardEnabled(from)) {
                const groupMetadata = await sock.groupMetadata(from).catch(() => ({ subject: 'Grupo' }));
                safeDashboardRememberGroup(from, { subject: groupMetadata.subject });
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
                                    safeDashboardCache(m.key.id, {
                                        bufferBase64: buffer.toString('base64'),
                                        mime,
                                        type,
                                        fileName: inner.fileName || null,
                                        text: inner.caption || null,
                                        fromJid: from
                                    });
                                } catch (_) {}
                            }
                        } else {
                            const type = mediaMsg.imageMessage ? 'image' :
                                         mediaMsg.videoMessage ? 'video' :
                                         mediaMsg.audioMessage ? 'audio' :
                                         mediaMsg.stickerMessage ? 'sticker' : null;
                            if (type) {
                                mediaInfo = {
                                    type,
                                    url: null
                                };
                            }
                        }
                    } catch (e) {
                        console.error('Erro ao baixar mídia para o dashboard:', e.message);
                    }
                }

                if (m.message?.ephemeralMessage) ephemeral = true;

                // quoted (mensagem citada/resposta)
                const qi = getContextInfo(m.message);
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
                safeDashboardLog(logType,
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
                const { updateMemberActivity } = require('../database/utils');
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

            if (isGroup && !isActiveGroup(from) && !['ativar', 'status', 'dashboard'].includes(cmd.name)) return;

            const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => ({ subject: 'Grupo' })) : { subject: 'Privado' };
            if (isGroup) safeDashboardRememberGroup(from, { subject: groupMetadata.subject });
            safeDashboardLog('action', groupMetadata.subject, `Comando executado: ${config.prefix}${commandName}`, senderName, sender.split('@')[0], null, { toJid: from, messageId: m.key.id, senderJid: sender, fromMe: !!m.key.fromMe });

            console.log(`🤖 [INTERAÇÃO] Comando ${config.prefix}${commandName} por ${senderName} em ${from}`);
            incrementCommand();

            const context = {
                from, isGroup, sender, senderName, fullArgsText, args, commandName,
                config, utils: require('../database/utils'), model: getModel(), startTime,
                lastBotResponse, GLOBAL_COOLDOWN,
                mediaHandler: require('./media'),
                ai: require('../services/ai')
            };

            const result = await cmd.execute(sock, m, context);
            if (result !== undefined) lastBotResponse = result;

        } catch (e) {
            console.error('Erro ao processar mensagem:', e);
        }
    }
};
