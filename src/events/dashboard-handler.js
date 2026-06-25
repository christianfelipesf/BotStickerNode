const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

const {
    getMediaMessage, getContextInfo, getMessageText,
    insertDashboardLog, isDashboardEnabled,
    groupMetadataCached
} = require('../database/utils');

const dashboard = require('../dashboard/dashboard');
const safeDashboardLog = (...args) => { try { dashboard.log(...args); } catch (_) {} };
const safeDashboardCache = (...args) => { try { dashboard.cacheMedia(...args); } catch (_) {} };
const safeDashboardRememberGroup = (...args) => { try { dashboard.rememberGroupInfo(...args); } catch (_) {} };
const safeDashboardMediaReceived = (...args) => { try { return dashboard.mediaForLogReceived(...args); } catch (_) { return null; } };

async function handleDashboardLog(sock, m, from, sender, senderName, text, groupMetadata) {
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

            const innerKey = mediaMsg ? Object.keys(mediaMsg).find(k => /Message$/.test(k)) : null;
            const inner = innerKey ? mediaMsg[innerKey] : null;
            const type = mediaMsg?.imageMessage ? 'image' :
                         mediaMsg?.videoMessage ? 'video' :
                         mediaMsg?.audioMessage ? 'audio' :
                         mediaMsg?.stickerMessage ? 'sticker' :
                         mediaMsg?.documentMessage ? 'document' : null;
            const mime = inner?.mimetype || 'application/octet-stream';

            if (type) {
                if (buffer) {
                    const isVO = type !== 'document' && !!inner.viewOnce;
                    const persisted = safeDashboardMediaReceived({ type, url: `data:${mime};base64,${buffer.toString('base64')}` }, m.key.id);
                    mediaInfo = persisted || { type, url: `data:${mime};base64,${buffer.toString('base64')}` };
                    if (type === 'image' || type === 'video' || type === 'audio') hidden = isVO;
                    if (type === 'document') { mediaInfo.fileName = inner.fileName || 'documento'; mediaInfo.mime = mime; mediaInfo.sizeBytes = inner.fileLength || buffer.length; }
                    try { safeDashboardCache(m.key.id, { bufferBase64: buffer.toString('base64'), mime, type, fileName: inner.fileName || null, text: inner.caption || null, fromJid: from }); } catch (_) {}
                } else {
                    mediaInfo = { type, url: null };
                    if (type === 'document') { mediaInfo.fileName = inner?.fileName || 'documento'; mediaInfo.mime = mime; }
                }
            }
        } catch (e) {
            console.error('Erro ao baixar mídia para o dashboard:', e.message);
        }
    }

    if (m.message?.ephemeralMessage) ephemeral = true;

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
            try { const p = groupMetadata.participants?.find(pp => pp.id === qSender); return p?.name || p?.notify || (qSender ? '@' + qSender.split('@')[0] : null); } catch (_) { return qSender ? '@' + qSender.split('@')[0] : null; }
        })();
        quotedInfo = { text: qText || null, hasMedia: !!(qi.quotedMessage.imageMessage || qi.quotedMessage.videoMessage || qi.quotedMessage.audioMessage || qi.quotedMessage.stickerMessage || qi.quotedMessage.documentMessage), senderJid: qSender, phone: qSender ? qSender.split('@')[0] : null, name: qSenderName };
    }

    const logType = hidden ? 'viewonce' : 'chat';
    safeDashboardLog(logType, groupMetadata.subject,
        text || (mediaInfo ? `[${mediaInfo.type}${hidden ? ' • viewOnce' : ''}]` : ''),
        senderName, sender.split('@')[0], mediaInfo,
        { toJid: from, messageId: m.key.id, senderJid: sender, fromMe: !!m.key.fromMe, quoted: quotedInfo, hidden, ephemeral }
    );
}

async function handleProtocolMessage(sock, m, from, sender, senderName) {
    const protocolMsg = m.message?.protocolMessage || m.message?.ephemeralMessage?.message?.protocolMessage;
    if (!protocolMsg || protocolMsg.type !== 3) return false;
    const groupMetadata = await groupMetadataCached(sock, from).catch(() => ({ subject: 'Grupo' }));
    safeDashboardRememberGroup(from, {
        subject: groupMetadata.subject,
        memberCount: Array.isArray(groupMetadata.participants) ? groupMetadata.participants.length : undefined,
        ownerJid: groupMetadata.owner || groupMetadata.subjectOwner || null
    });
    safeDashboardLog('chat', groupMetadata.subject, '📑 [Apagou uma mensagem]', senderName, sender.split('@')[0], null,
        { toJid: from, messageId: m.key.id, senderJid: sender, fromMe: !!m.key.fromMe, ephemeral: !!m.message?.ephemeralMessage }
    );
    return true;
}

async function handleReaction(sock, m, from, sender, senderName) {
    const reactionMsg = m.message?.reactionMessage || m.message?.ephemeralMessage?.message?.reactionMessage;
    if (!reactionMsg) return false;
    if (from.endsWith('@g.us') && isDashboardEnabled(from)) {
        const targetId = reactionMsg.key.id;
        const emoji = reactionMsg.text || '';
        const { handleReaction: handleDashReaction } = require('../dashboard/dashboard');
        handleDashReaction(targetId, emoji, sender, senderName);
    }
    return true;
}

module.exports = {
    handleDashboardLog,
    handleProtocolMessage,
    handleReaction,
    safeDashboardLog,
    safeDashboardRememberGroup
};
