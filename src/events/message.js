const { getModel } = require('../services/ai');
const cooldown = require('../services/cooldown');
const trace = require('../services/trace');
const { handleDashboardLog, handleProtocolMessage, handleReaction, safeDashboardLog, safeDashboardRememberGroup } = require('./dashboard-handler');
const { enforceMuteAndAntilink } = require('./enforcement');

const {
    isActiveGroup, isPartialActive, getPartialWaitMs,
    incrementCommand, formatUptime,
    readConfig, saveMessage,
    getBotName, react, getMessageText,
    isDashboardEnabled, groupMetadataCached, updateMemberActivity
} = require('../database/utils');

// ============================================================
// Deduplication
// ============================================================
const processedMessages = new Set();
setInterval(() => processedMessages.clear(), 10 * 60 * 1000).unref();

// ============================================================
// Recent message buffer (for !limpar)
// ============================================================
const RECENT_BUFFER_LIMIT = 100;
const recentMessagesByGroup = new Map();

function trackRecentMessage(jid, key) {
    if (!jid || !key || !key.id) return;
    let list = recentMessagesByGroup.get(jid);
    if (!list) { list = []; recentMessagesByGroup.set(jid, list); }
    list.push({ id: key.id, participant: key.participant || null, fromMe: !!key.fromMe });
    if (list.length > RECENT_BUFFER_LIMIT) list.shift();
}

function getRecentMessages(jid, limit) {
    const list = recentMessagesByGroup.get(jid) || [];
    return list.slice(-Math.max(1, Math.min(limit, list.length)));
}

// ============================================================
// Partial Activation
// ============================================================
const partialPending = new Map();
const PARTIAL_ALLOWED_CATEGORIES = new Set(['mídia']);
const PARTIAL_BLOCKED_COMMANDS = new Set([
    'ban', 'add', 'mute', 'desmute', 'antilink', 'limpar', 'clear', 'purge', 'delete', 'apagar', 'del', 'clearchat',
    'divulgar', 'mencionar', 'set', 'setprefix', 'setlink', 'dashreset', 'newsreset',
    'dashboardativar', 'dashboarddesativar', 'newsativar', 'newsdesativar', 'dump', 'config', 'nome',
    'log', 'logs', 'logsterminal', 'terminallog',
    'menu', 'help', 'comandos', 'status', 'prefixo', 'prefix', 'resumir', 'grupos', 'perfil', 'ai'
]);
const PARTIAL_BYPASS_COMMANDS = new Set(['ativar', 'desativar', 'ativarp', 'desativarp', 'status', 'dashboard', 'dash', 'painel']);

function _partialKey(jid, msgId) { return `${jid}:${msgId}`; }

function _isPartialAllowed(cmd) {
    if (!cmd) return false;
    if (PARTIAL_BLOCKED_COMMANDS.has(cmd.name)) return false;
    if (Array.isArray(cmd.aliases)) for (const a of cmd.aliases) if (PARTIAL_BLOCKED_COMMANDS.has(a)) return false;
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

function cancelPartialPending(jid, msgId) {
    const k = _partialKey(jid, msgId);
    const entry = partialPending.get(k);
    if (entry && entry.timer) clearTimeout(entry.timer);
    partialPending.delete(k);
    if (entry && entry.resolve) entry.resolve({ reacted: true });
}

function notifyPartialReaction(jid, msgId, reactorJid) {
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

// ============================================================
// Constants
// ============================================================
const GLOBAL_COOLDOWN = 1000;
let lastBotResponse = 0;
// ============================================================
// Main message handler
// ============================================================
module.exports = {
    handleMessageUpsert: async (sock, { messages, type }, { commands, config, startTime }) => {
        if (type !== 'notify' && !messages?.some(msg => msg?.key?.fromMe)) return;
        const _evtStart = Date.now();
        try {
            const m = messages[0];
            if (!m.message || processedMessages.has(m.key.id)) return;

            const messageTime = m.messageTimestamp?.low || m.messageTimestamp || 0;
            if (messageTime < Math.floor(startTime / 1000) + 2) return;

            processedMessages.add(m.key.id);

            const from = m.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            if (isGroup) trackRecentMessage(from, m.key);

            const sender = m.key.fromMe
                ? (sock.user?.id || m.key.participant || m.key.remoteJid)
                : (m.key.participant || m.key.remoteJid);
            const text = (getMessageText(m.message) || '').trim();
            const senderName = m.key.fromMe ? config.botName : (m.pushName || 'Usuário');

            // === Reactions ===
            if (await handleReaction(sock, m, from, sender, senderName)) {
                try {
                    const tgt = m.message?.reactionMessage?.key?.id || m.message?.ephemeralMessage?.message?.reactionMessage?.key?.id;
                    if (isGroup && tgt) notifyPartialReaction(from, tgt, sender);
                } catch (_) {}
                return;
            }

            // === Protocol messages (deleted, etc) ===
            if (await handleProtocolMessage(sock, m, from, sender, senderName)) return;

            const botActive = !isGroup || isActiveGroup(from);
            const dashOn = isDashboardEnabled(from);

            // === Mute & Antilink enforcement ===
            if (isGroup && botActive) {
                const enforcement = await enforceMuteAndAntilink(sock, m, from, sender, text);
                if (enforcement === 'muted' || enforcement === 'antilink') return;
            }

            // === Dashboard logging (mídia baixada em background via fila) ===
            if (dashOn) {
                const groupMetadata = isGroup
                    ? await groupMetadataCached(sock, from).catch(() => ({ subject: 'Grupo' }))
                    : { subject: senderName || 'Privado', participants: [] };
                await handleDashboardLog(sock, m, from, sender, senderName, text, groupMetadata);
            }

            // === Save message for !resumir ===
            if (isGroup && botActive && text && !text.startsWith(config.prefix)) {
                saveMessage(from, m.pushName || senderName, text);
            }

            // === Activity tracking (bufferizado em memória, flush periódico) ===
            if (botActive && isGroup) {
                updateMemberActivity(from, sender, senderName);
            }

            // === Prefix query ===
            if ((text.toLowerCase() === 'prefixo' || text.toLowerCase() === 'prefix') && botActive) {
                const stats = require('../database/utils').readStats();
                const now = Date.now();
                lastBotResponse = await react(sock, m, 'ℹ️', lastBotResponse, GLOBAL_COOLDOWN);
                return await sock.sendMessage(from, {
                    text: `🌌 *${getBotName(from, config)}*\n\n⌨️ *Prefixo:* ${config.prefix}\n⏱️ *Uptime:* ${formatUptime((now - startTime) / 1000)}\n⌨️ *Comandos:* ${stats.totalCommands}\n💻 *Plataforma:* ${process.platform === 'win32' ? 'Windows' : 'Linux'}`
                }, { quoted: m });
            }

            // === Command detection ===
            if (!text.startsWith(config.prefix)) return;
            const args = text.slice(config.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const fullArgsText = args.join(' ');

            const cmd = commands.get(commandName) || Array.from(commands.values()).find(c => c.aliases?.includes(commandName));
            if (!cmd) return;

            // === Activation control commands always work ===
            const activationControlCmds = ['ativar', 'desativar', 'ativarp', 'desativarp', 'status', 'dashboard', 'dash', 'painel', 'dashdel', 'dashremover', 'dashremove'];
            const isPartActive = isGroup && isPartialActive(from);
            if (isGroup && !botActive && !isPartActive && !activationControlCmds.includes(cmd.name)) {
                return;
            }

            // === Cooldown ===
            if (!m.key.fromMe) {
                const remaining = cooldown.checkCooldown(cmd.name, sender);
                if (remaining > 0) {
                    console.log(`⏳ [COOLDOWN] !${commandName} por ${senderName} — aguarde ${Math.ceil(remaining / 1000)}s`);
                    try { await sock.sendMessage(from, { react: { text: '⏳', key: m.key } }); } catch (_) {}
                    return;
                }
            }

            // === Partial activation ===
            if (isPartActive) {
                if (PARTIAL_BYPASS_COMMANDS.has(cmd.name)) {
                    // bypass
                } else if (!_isPartialAllowed(cmd)) {
                    console.log(`🤐 [PARCIAL] comando ${config.prefix}${commandName} bloqueado em ${from}`);
                    try {
                        const gm = await groupMetadataCached(sock, from).catch(() => ({ subject: 'Grupo' }));
                        safeDashboardLog('action', gm.subject, `🤐 [PARCIAL] !${commandName} bloqueado`, senderName, sender.split('@')[0], null, { toJid: from, messageId: m.key.id, senderJid: sender, fromMe: !!m.key.fromMe });
                    } catch (_) {}
                    return;
                } else {
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

            // === Pre-command tracking ===
            const groupMetadata = isGroup ? await groupMetadataCached(sock, from).catch(() => ({ subject: 'Grupo' })) : { subject: 'Privado' };
            if (isGroup) safeDashboardRememberGroup(from, {
                subject: groupMetadata.subject,
                memberCount: Array.isArray(groupMetadata.participants) ? groupMetadata.participants.length : undefined,
                ownerJid: groupMetadata.owner || groupMetadata.subjectOwner || null
            });

            const botActiveInGroup = botActive || isPartActive;
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

            // === Tracing setup (leve, sem monkey-patch de console) ===
            const t0 = Date.now();
            let stepN = 0;
            const traceTag = `cmd.!${commandName}`;
            let _traceCapture = false;
            const origLog = console.log.bind(console);
            console.log = (...a) => {
                if (!_traceCapture) return origLog(...a);
                const now = Date.now();
                const delta = now - t0;
                stepN += 1;
                const msg = a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (_) { return String(x); } })())).join(' ');
                origLog(`   └─ [${new Date().toLocaleTimeString('pt-BR', { hour12: false })}] [+${String(delta).padStart(5,' ')}ms / total ${now - t0}ms] ${traceTag} #${stepN}${msg ? ` ${msg}` : ''}`);
            };

            _traceCapture = true;
            console.log('início', `${senderName} → ${config.prefix}${commandName}${fullArgsText ? ` args="${fullArgsText.slice(0,80)}"` : ''}`);

            // === Command execution ===
            try {
                const result = await cmd.execute(sock, m, context);
                if (result !== undefined) lastBotResponse = result;
                const elapsed = Date.now() - t0;
                console.log('fim', `ok em ${elapsed}ms`);
                if (botActiveInGroup && elapsed >= 800) {
                    safeDashboardLog('action', groupMetadata.subject, `✅ !${commandName} concluído em ${elapsed}ms`, config.botName || 'Bot', (sock.user?.id || '').split(':')[0].split('@')[0] || 'bot', null, { toJid: from, messageId: m.key.id, senderJid: sock.user?.id || '', fromMe: true });
                }
            } catch (cmdErr) {
                const elapsed = Date.now() - t0;
                console.error(`💥 [CMD-ERROR] ${config.prefix}${commandName}:`, cmdErr);
                console.log('ERRO', `${cmdErr?.message || cmdErr} (após ${elapsed}ms)`);
                if (botActiveInGroup || !isGroup) {
                    safeDashboardLog('error', groupMetadata.subject, `❌ Erro em !${commandName} após ${elapsed}ms: ${cmdErr?.message || cmdErr}`, config.botName || 'Bot', (sock.user?.id || '').split(':')[0].split('@')[0] || 'bot', null, { toJid: from, messageId: m.key.id, senderJid: sock.user?.id || '', fromMe: true });
                }
                throw cmdErr;
            } finally {
                _traceCapture = false;
                console.log = origLog;
            }

        } catch (e) {
            console.error(`[${trace.ts()}] [evt] messages.upsert ERRO: ${e.message} | stack[0]=${(e.stack||'').split('\n')[1]?.trim() || ''} (após ${Date.now()-_evtStart}ms)`);
            console.error('Erro ao processar mensagem:', e);
        }
    },
    trackRecentMessage,
    getRecentMessages,
    notifyPartialReaction,
    isPartialActive
};
