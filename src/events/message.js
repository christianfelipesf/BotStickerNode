const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { revealViewOnce } = require('./media');
const { getModel } = require('../services/ai');
const dashboard = require('../dashboard/dashboard');

const {
    isActiveGroup, activateGroup, deactivateGroup,
    isPartialActive, activatePartial, deactivatePartial, getPartialWaitMs,
    getGroupData, setGroupData, saveGroupMenuImage,
    isViewOnce, getMediaMessage, getContextInfo, mediaToSticker, stickerToMedia,
    readStats, incrementCommand, formatUptime,
    readConfig, writeConfig, saveMessage, getChatHistory,
    changeSpeed, getBotName, react, getMessageText,
    isDashboardEnabled, listDashboardGroups, setDashboardEnabled,
    groupMetadataCached
} = require('../database/utils');

const dashboardCacheMedia = dashboard.cacheMedia;
const dashboardPushGroups = dashboard.pushGroupsSnapshot;
const dashboardRememberGroup = dashboard.rememberGroupInfo;
const dashboardMediaForLogReceived = dashboard.mediaForLogReceived;

const safeDashboardLog = (...args) => { try { dashboard.log(...args); } catch (_) {} };
const safeDashboardCache = (...args) => { try { dashboardCacheMedia(...args); } catch (_) {} };
const safeDashboardRememberGroup = (...args) => { try { dashboardRememberGroup(...args); } catch (_) {} };
const safeDashboardMediaReceived = (...args) => { try { return dashboardMediaForLogReceived(...args); } catch (_) { return null; } };

const processedMessages = new Set();
// Limpa periodicamente para evitar crescimento infinito da memória
const _processedMessagesInterval = setInterval(() => processedMessages.clear(), 10 * 60 * 1000);
if (typeof _processedMessagesInterval.unref === 'function') _processedMessagesInterval.unref();

// Ring buffer de chaves recentes por grupo (para !limpar deletar N últimas)
const RECENT_BUFFER_LIMIT = 100;
const recentMessagesByGroup = new Map();

function trackRecentMessage(jid, key) {
    if (!jid || !key || !key.id) return;
    let list = recentMessagesByGroup.get(jid);
    if (!list) {
        list = [];
        recentMessagesByGroup.set(jid, list);
    }
    list.push({ id: key.id, participant: key.participant || null, fromMe: !!key.fromMe });
    if (list.length > RECENT_BUFFER_LIMIT) list.shift();
}

function getRecentMessages(jid, limit) {
    const list = recentMessagesByGroup.get(jid) || [];
    return list.slice(-Math.max(1, Math.min(limit, list.length)));
}

// ============================================================
// Ativamento Parcial — pendentes de resposta
// Quando um grupo está em modo parcial (!ativarp), o bot:
//   1) registra a mensagem-comando como "pendente"
//   2) aguarda `partialWaitMs` ms checando se alguém reagiu à mensagem
//   3) se ninguém reagiu nesse tempo E o comando for permitido, executa
//   4) se outro bot (não este) reagiu OU o comando não é permitido, ignora
// ============================================================
const partialPending = new Map(); // key = `${jid}:${msgId}` -> { resolve, timer, botJid, commandName, isGroup }
const PARTIAL_ALLOWED_CATEGORIES = new Set(['mídia']);
// Comandos admin/críticos nunca respondem em modo parcial, mesmo que categoria
const PARTIAL_BLOCKED_COMMANDS = new Set([
    'ban', 'add', 'mute', 'desmute', 'antilink', 'limpar', 'clear', 'purge', 'delete', 'apagar', 'del', 'clearchat',
    'divulgar', 'mencionar', 'set', 'setprefix', 'setlink', 'dashreset', 'newsreset',
    'dashboardativar', 'dashboarddesativar', 'newsativar', 'newsdesativar', 'dump', 'config', 'nome',
    'menu', 'help', 'comandos', 'status', 'prefixo', 'prefix', 'resumir', 'grupos', 'perfil', 'ai'
]);
// Comandos que controlam o próprio modo de ativamento (sempre funcionam,
// inclusive dentro do modo parcial — senão o usuário não consegue desligar).
const PARTIAL_BYPASS_COMMANDS = new Set(['ativar', 'desativar', 'ativarp', 'desativarp', 'status']);

function _partialKey(jid, msgId) { return `${jid}:${msgId}`; }

function _isPartialAllowed(cmd) {
    if (!cmd) return false;
    if (PARTIAL_BLOCKED_COMMANDS.has(cmd.name)) return false;
    if (Array.isArray(cmd.aliases)) {
        for (const a of cmd.aliases) if (PARTIAL_BLOCKED_COMMANDS.has(a)) return false;
    }
    return PARTIAL_ALLOWED_CATEGORIES.has(cmd.category);
}

function registerPartialPending(jid, msgId, commandName, botJid) {
    if (!jid || !msgId) return;
    const k = _partialKey(jid, msgId);
    if (partialPending.has(k)) return;
    let resolveFn;
    const promise = new Promise(resolve => { resolveFn = resolve; });
    partialPending.set(k, { resolve: resolveFn, botJid, commandName, jid, isGroup: jid?.endsWith('@g.us') });
    return promise;
}

function consumePartialPending(jid, msgId) {
    const k = _partialKey(jid, msgId);
    const entry = partialPending.get(k);
    if (!entry) return null;
    partialPending.delete(k);
    return entry;
}

function cancelPartialPending(jid, msgId) {
    const k = _partialKey(jid, msgId);
    const entry = partialPending.get(k);
    if (entry && entry.timer) clearTimeout(entry.timer);
    partialPending.delete(k);
    if (entry && entry.resolve) entry.resolve({ reacted: true });
}

function notifyPartialReaction(jid, msgId, reactorJid) {
    // Se o reactor NÃO for este bot, cancela o pendente (outro bot respondeu)
    const k = _partialKey(jid, msgId);
    const entry = partialPending.get(k);
    if (!entry) return false;
    try {
        const reactorNorm = (reactorJid || '').split('@')[0].split(':')[0];
        const botNorm = (entry.botJid || '').split('@')[0].split(':')[0];
        if (reactorNorm && botNorm && reactorNorm === botNorm) return false;
    } catch (_) {}
    cancelPartialPending(jid, msgId);
    return true;
}

function setPartialTimer(jid, msgId, ms) {
    const k = _partialKey(jid, msgId);
    const entry = partialPending.get(k);
    if (!entry) return;
    entry.timer = setTimeout(() => {
        const cur = partialPending.get(k);
        if (!cur) return;
        partialPending.delete(k);
        try { cur.resolve({ reacted: false }); } catch (_) {}
    }, Math.max(0, ms || 0));
}

// Limpa pendentes com mais de 5 minutos para evitar leak caso reaction
// nunca chegue e o timer falhe (defesa em profundidade).
setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [k, entry] of partialPending.entries()) {
        if (entry.timer && entry.timer._idleStart && entry.timer._idleStart < cutoff) {
            try { clearTimeout(entry.timer); } catch (_) {}
            partialPending.delete(k);
            try { entry.resolve && entry.resolve({ reacted: true }); } catch (_) {}
        }
    }
}, 60 * 1000).unref();

const GLOBAL_COOLDOWN = 1000;
let lastBotResponse = 0;
const AUTO_VIEW_ONCE = true;

const trace = require('../services/trace');

module.exports = {
    handleMessageUpsert: async (sock, { messages, type }, { commands, config, startTime }) => {
        if (type !== 'notify' && !messages?.some(msg => msg?.key?.fromMe)) return;
        const _evtStart = Date.now();
        try {
            const m = messages[0];
            if (!m.message || processedMessages.has(m.key.id)) return;
            
            const messageTime = m.messageTimestamp?.low || m.messageTimestamp || 0;
            const bootThreshold = Math.floor(startTime / 1000) + 10;
            if (messageTime < bootThreshold) return;

            processedMessages.add(m.key.id);

            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            if (isGroup) trackRecentMessage(from, m.key);
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
                // Notifica o sistema de ativamento parcial: se alguém (que não é este bot)
                // reagiu a uma mensagem de comando pendente, cancela a execução.
                try {
                    const tgt = reactionMsg.key?.id;
                    if (isGroup && tgt) notifyPartialReaction(from, tgt, sender);
                } catch (_) {}
                return;
            }

            // Tratamento especial para Protocolos (como mensagens apagadas)
            const protocolMsg = m.message?.protocolMessage || m.message?.ephemeralMessage?.message?.protocolMessage;
            if (protocolMsg) {
                if (protocolMsg.type === 3 && isGroup && isDashboardEnabled(from)) {
                    const groupMetadata = await groupMetadataCached(sock, from).catch(() => ({ subject: 'Grupo' }));
                    safeDashboardRememberGroup(from, {
                        subject: groupMetadata.subject,
                        memberCount: Array.isArray(groupMetadata.participants) ? groupMetadata.participants.length : undefined,
                        ownerJid: groupMetadata.owner || groupMetadata.subjectOwner || null
                    });
                    
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
                const groupMetadata = await groupMetadataCached(sock, from).catch(() => ({ subject: 'Grupo' }));
                safeDashboardRememberGroup(from, {
                    subject: groupMetadata.subject,
                    memberCount: Array.isArray(groupMetadata.participants) ? groupMetadata.participants.length : undefined,
                    ownerJid: groupMetadata.owner || groupMetadata.subjectOwner || null,
                    desc: groupMetadata.desc || groupMetadata.description || null
                });
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
                const mediaForDb = safeDashboardMediaReceived(mediaInfo, m.key.id) || mediaInfo;
                safeDashboardLog(logType,
                    groupMetadata.subject,
                    text || (mediaInfo ? `[${mediaInfo.type}${hidden ? ' • viewOnce' : ''}]` : ''),
                    senderName,
                    sender.split('@')[0],
                    mediaForDb,
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

            // Comandos de controle de ativamento funcionam mesmo com bot inativo/parcial
            const activationControlCmds = ['ativar', 'desativar', 'ativarp', 'desativarp', 'status'];
            if (isGroup && !isActiveGroup(from) && !activationControlCmds.includes(cmd.name)) {
                // Em grupo inativo E não-parcial, mantém comportamento original
                if (!isPartialActive(from)) return;
            }

            // ============================================================
            // ATIVAMENTO PARCIAL: se o grupo está em modo parcial,
            // comandos admin ficam mudos e comandos de mídia só
            // respondem após `partialWaitMs` sem reação de outro bot.
            // Comandos de controle de ativamento (!ativar/!desativar/
            // !ativarp/!desativarp/!status) sempre passam — caso
            // contrário, o usuário não consegue sair do modo parcial.
            // ============================================================
            if (isGroup && isPartialActive(from)) {
                if (PARTIAL_BYPASS_COMMANDS.has(cmd.name)) {
                    // Bypass intencional — permite sair do modo parcial.
                } else if (!_isPartialAllowed(cmd)) {
                    console.log(`🤐 [PARCIAL] comando ${config.prefix}${commandName} bloqueado em ${from}`);
                    try {
                        safeDashboardLog('action', (await groupMetadataCached(sock, from).catch(() => ({ subject: 'Grupo' }))).subject,
                            `🤐 [PARCIAL] !${commandName} bloqueado`, senderName, sender.split('@')[0],
                            null, { toJid: from, messageId: m.key.id, senderJid: sender, fromMe: !!m.key.fromMe });
                    } catch (_) {}
                    return;
                } else {
                    // Registrar pendente e esperar — se alguém reagir, cancela.
                    const botJid = (sock.user?.id || '').split(':')[0] + '@s.whatsapp.net';
                    const waitMs = getPartialWaitMs();
                    const pendingPromise = registerPartialPending(from, m.key.id, commandName, botJid);
                    if (pendingPromise && waitMs > 0) {
                        setPartialTimer(from, m.key.id, waitMs);
                        const result = await pendingPromise;
                        if (result && result.reacted) {
                            console.log(`🤐 [PARCIAL] outro bot reagiu a !${commandName} em ${from}, ignorando`);
                            return;
                        }
                    }
                }
            }

            const groupMetadata = isGroup ? await groupMetadataCached(sock, from).catch(() => ({ subject: 'Grupo' })) : { subject: 'Privado' };
            if (isGroup) safeDashboardRememberGroup(from, {
                subject: groupMetadata.subject,
                memberCount: Array.isArray(groupMetadata.participants) ? groupMetadata.participants.length : undefined,
                ownerJid: groupMetadata.owner || groupMetadata.subjectOwner || null
            });
            const botActiveInGroup = isGroup && (isActiveGroup(from) || isPartialActive(from));
            if (botActiveInGroup || !isGroup) {
                safeDashboardLog('action', groupMetadata.subject, `Comando executado: ${config.prefix}${commandName}`, senderName, sender.split('@')[0], null, { toJid: from, messageId: m.key.id, senderJid: sender, fromMe: !!m.key.fromMe });
            }

            console.log(`🤖 [INTERAÇÃO] Comando ${config.prefix}${commandName} por ${senderName} em ${from}`);
            incrementCommand();

            const context = {
                from, isGroup, sender, senderName, fullArgsText, args, commandName,
                config, utils: require('../database/utils'), model: getModel(), startTime,
                lastBotResponse, GLOBAL_COOLDOWN,
                mediaHandler: require('./media'),
                ai: require('../services/ai')
            };

            const t0 = Date.now();
            const stepStart = t0;
            let stepN = 0;
            const fmtTs = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });
            const traceTag = `cmd.!${commandName}`;
            const traceLog = (label, detail) => {
                const now = Date.now();
                const delta = now - stepStart;
                const total = now - t0;
                stepN += 1;
                const detailPart = detail ? ` — ${detail}` : '';
                console.log(`   └─ [${fmtTs()}] [+${String(delta).padStart(5,' ')}ms / total ${total}ms] ${traceTag} #${stepN} ${label}${detailPart}`);
            };
            const origLog = console.log.bind(console);
            const origInfo = console.info?.bind(console);
            const origWarn = console.warn?.bind(console);
            console.log = (...a) => {
                try {
                    const msg = a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (_) { return String(x); } })())).join(' ');
                    if (msg && !msg.includes('[INTERAÇÃO]') && !msg.startsWith('   └─')) {
                        traceLog('log', msg);
                        return;
                    }
                } catch (_) {}
                return origLog(...a);
            };
            if (origInfo) console.info = (...a) => { try { traceLog('info', a.map(x => typeof x === 'string' ? x : String(x)).join(' ')); } catch (_) {} };
            if (origWarn) console.warn = (...a) => { try { traceLog('warn', a.map(x => typeof x === 'string' ? x : String(x)).join(' ')); } catch (_) {} };

            traceLog('início', `${senderName} → ${config.prefix}${commandName}${fullArgsText ? ` args="${fullArgsText.slice(0,80)}"` : ''}`);

            let result;
            try {
                result = await cmd.execute(sock, m, context);
            } catch (cmdErr) {
                const elapsed = Date.now() - t0;
                const errText = `❌ Erro em !${commandName} após ${elapsed}ms: ${cmdErr?.message || cmdErr}`;
                console.error(`💥 [CMD-ERROR] ${config.prefix}${commandName}:`, cmdErr);
                traceLog('ERRO', `${cmdErr?.message || cmdErr} (após ${elapsed}ms)`);
                if (botActiveInGroup || !isGroup) {
                    safeDashboardLog('error', groupMetadata.subject, errText, config.botName || 'Bot', (sock.user?.id || '').split(':')[0].split('@')[0] || 'bot', null, { toJid: from, messageId: m.key.id, senderJid: sock.user?.id || '', fromMe: true });
                }
                console.log = origLog;
                if (origInfo) console.info = origInfo;
                if (origWarn) console.warn = origWarn;
                throw cmdErr;
            }
            console.log = origLog;
            if (origInfo) console.info = origInfo;
            if (origWarn) console.warn = origWarn;

            if (result !== undefined) lastBotResponse = result;
            const elapsed = Date.now() - t0;
            traceLog('fim', `ok em ${elapsed}ms`);
            if (botActiveInGroup && elapsed >= 800) {
                safeDashboardLog('action', groupMetadata.subject, `✅ !${commandName} concluído em ${elapsed}ms`, config.botName || 'Bot', (sock.user?.id || '').split(':')[0].split('@')[0] || 'bot', null, { toJid: from, messageId: m.key.id, senderJid: sock.user?.id || '', fromMe: true });
            }

        } catch (e) {
            console.error(trace.step('evt', 'messages.upsert ERRO', `${e.message} | stack[0]=${(e.stack||'').split('\n')[1]?.trim() || ''} (após ${Date.now()-_evtStart}ms)`));
            console.error('Erro ao processar mensagem:', e);
        }
    },
    trackRecentMessage,
    getRecentMessages,
    notifyPartialReaction,
    isPartialActive
};
