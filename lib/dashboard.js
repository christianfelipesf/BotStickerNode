const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { mediaToSticker } = require('../utils');

let ioServer = null;
let sockRef = null;
const dashboardLogs = []; // RAM
const MAX_LOGS = 500;

// Cache de mídia recente (por messageId): { buffer(base64), mime, type, fromJid }
// Usado para hidratar quotedMessage no /api/reply e mostrar viewOnce com mídia.
const mediaCache = new Map();
const MAX_CACHE = 60;

function cacheMedia(messageId, info) {
    if (!messageId) return;
    mediaCache.set(messageId, info);
    if (mediaCache.size > MAX_CACHE) {
        const firstKey = mediaCache.keys().next().value;
        mediaCache.delete(firstKey);
    }
}

function getCachedMedia(messageId) {
    return messageId ? mediaCache.get(messageId) : null;
}

function attachSock(sock) { sockRef = sock; }

function init(config) {
    if (config.dashboardEnabled === false) return null;

    const port = config.dashboardPort || 3000;
    const app = express();
    const server = http.createServer(app);

    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });
    app.use(express.json({ limit: '80mb' }));

    app.post('/api/reply', apiHandler(sendReply));
    app.post('/api/send', apiHandler(sendDirect));
    app.get('/api/health', (req, res) => res.json({ ok: !!sockRef }));
    app.use('/api', (req, res) => res.status(404).json({ ok: false, error: `Endpoint nao encontrado: ${req.path}` }));
    app.get('/dashboard.css', (req, res) => res.type('css').sendFile(path.join(__dirname, 'dashboard.css')));
    app.get('/dashboard.js', (req, res) => res.type('javascript').sendFile(path.join(__dirname, 'dashboard-client.js')));
    app.get('/', (req, res) => res.type('html').send(getHtml(config.botName)));
    app.use((err, req, res, next) => {
        const status = err?.type === 'entity.too.large' ? 413 : 400;
        const error = status === 413 ? 'Arquivo muito grande para enviar pelo dashboard' : 'JSON invalido';
        res.status(status).json({ ok: false, error });
    });

    ioServer = new Server(server);
    ioServer.on('connection', (socket) => socket.emit('history', dashboardLogs));

    server.listen(port, '0.0.0.0', () => console.log(`📊 Dashboard ativo em: http://localhost:${port}`));
    return ioServer;
}

function apiHandler(fn) {
    return async (req, res) => {
        try {
            const r = await fn(req.body || {});
            res.status(r.ok ? 200 : 400).json(r);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    };
}

// Constrói um quotedMessage SEGURO para o protocolo do WhatsApp.
// Sem mídia (apenas texto): usa conversation.
// Com mídia: usa conversation com marcador descritivo, NUNCA imageMessage/videoMessage
// sintético (sem mediaKey real o servidor recusa com "media id is not defined").
function buildQuotedPayload(quotedId, quotedParticipant, cached, fallbackText) {
    let label = fallbackText || 'Mensagem';

    if (cached) {
        if (cached.text) {
            label = cached.text;
        } else if (cached.type === 'image') label = '📷 Foto';
        else if (cached.type === 'video') label = '🎥 Vídeo';
        else if (cached.type === 'audio') label = '🎵 Áudio';
        else if (cached.type === 'sticker') label = '🏷️ Sticker';
        else if (cached.type === 'document') label = '📎 ' + (cached.fileName || 'Documento');
    }

    return {
        key: { remoteJid: '__jid__', id: quotedId, participant: quotedParticipant || undefined },
        message: { conversation: label }
    };
}

function getBotPhone() {
    return (sockRef?.user?.id || sockRef?.user?.jid || 'bot').split(':')[0].split('@')[0];
}

function getMediaLabel(type) {
    if (type === 'image') return 'Foto';
    if (type === 'video') return 'Video';
    if (type === 'audio') return 'Audio';
    if (type === 'sticker') return 'Sticker';
    if (type === 'document') return 'Documento';
    return 'Midia';
}

function mediaForLog(media) {
    if (!media || !media.dataBase64) return null;
    const sendType = media.sendType || media.type || 'document';
    const mime = media.mime || (sendType === 'sticker' ? 'image/webp' : 'application/octet-stream');
    if (!['image', 'video', 'audio', 'sticker'].includes(sendType)) return null;
    return {
        type: sendType,
        url: `data:${mime};base64,${media.dataBase64}`
    };
}

async function sendMediaMessage(toJid, text, media, opts = {}) {
    const buf = Buffer.from(media.dataBase64, 'base64');
    const caption = text ? String(text).slice(0, 1024) : undefined;
    const sendType = media.sendType || media.type;

    if (sendType === 'image') {
        return sockRef.sendMessage(toJid, { image: buf, mimetype: media.mime || 'image/jpeg', caption }, opts);
    }
    if (sendType === 'video') {
        return sockRef.sendMessage(toJid, { video: buf, mimetype: media.mime || 'video/mp4', caption, gifPlayback: !!media.gif }, opts);
    }
    if (sendType === 'audio') {
        return sockRef.sendMessage(toJid, { audio: buf, mimetype: media.mime || 'audio/mp4', ptt: !!media.ptt }, opts);
    }
    if (sendType === 'sticker') {
        const mime = media.mime || 'image/webp';
        const stickerBuffer = mime === 'image/webp'
            ? buf
            : await mediaToSticker(buf, mime, 'Dashboard', 'Bot');
        return sockRef.sendMessage(toJid, { sticker: stickerBuffer }, opts);
    }
    if (sendType === 'document') {
        return sockRef.sendMessage(toJid, { document: buf, mimetype: media.mime || 'application/octet-stream', fileName: media.fileName || 'arquivo', caption }, opts);
    }
    return { ok: false, error: 'Tipo de midia nao suportado: ' + sendType };
}

async function logSentMessage(toJid, text, media, sentId, quoted = null) {
    const mediaInfo = mediaForLog(media);
    const fallbackText = mediaInfo && !text ? `[${getMediaLabel(mediaInfo.type)}]` : '';
    log('chat', await getGroupName(toJid),
        text ? String(text).slice(0, 4096) : fallbackText,
        'Voce', getBotPhone(), mediaInfo,
        {
            toJid,
            messageId: sentId,
            senderJid: sockRef.user?.id || sockRef.user?.jid,
            fromMe: true,
            quoted
        });

    if (sentId && mediaInfo && media?.dataBase64) {
        cacheMedia(sentId, {
            bufferBase64: media.dataBase64,
            mime: media.mime || 'application/octet-stream',
            type: mediaInfo.type,
            fileName: media.fileName || null,
            text: text || null,
            fromJid: toJid
        });
    }
}

async function sendReply(payload) {
    if (!sockRef) return { ok: false, error: 'Bot não conectado' };
    const { toJid, text, quotedId, quotedParticipant, quotedFromMe, quotedText, media } = payload || {};
    if (!toJid) return { ok: false, error: 'Dados incompletos' };

    const hasText = !!(text && String(text).trim().length > 0);
    const hasMedia = !!(media && media.dataBase64 && (media.type || media.sendType));
    if (!hasText && !hasMedia) return { ok: false, error: 'Mensagem vazia' };

    // Monta options.quoted de forma segura
    const opts = {};
    if (quotedId) {
        const cached = getCachedMedia(quotedId);
        const quotedSafe = buildQuotedPayload(quotedId, quotedParticipant, cached, quotedText);
        if (quotedSafe) {
            opts.quoted = {
                key: { remoteJid: toJid, id: quotedId, participant: quotedParticipant || undefined, fromMe: !!quotedFromMe },
                message: quotedSafe.message
            };
        }
    }

    const quotedLog = quotedId ? {
        text: quotedText || null,
        hasMedia: !!getCachedMedia(quotedId),
        senderJid: quotedParticipant || null,
        phone: quotedParticipant ? quotedParticipant.split('@')[0] : null,
        name: quotedFromMe ? 'Voce' : null
    } : null;

    try {
        const sent = hasMedia
            ? await sendMediaMessage(toJid, hasText ? text : '', media, opts)
            : await sockRef.sendMessage(toJid, { text: String(text).slice(0, 4096) }, opts);
        if (sent?.ok === false) return sent;
        const sentId = sent && sent.key && sent.key.id;
        await logSentMessage(toJid, hasText ? text : '', hasMedia ? media : null, sentId, quotedLog);
        return { ok: true, messageId: sentId };
    } catch (sendErr) {
        console.error('Falha ao enviar via dashboard:', sendErr);
        return { ok: false, error: sendErr.message || 'Falha no envio' };
    }

    let sent;
    if (hasMedia) {
        const buf = Buffer.from(media.dataBase64, 'base64');
        const caption = hasText ? String(text).slice(0, 1024) : undefined;
        const sendType = media.type || media.sendType;
        try {
            if (sendType === 'image') {
                sent = await sockRef.sendMessage(toJid, { image: buf, mimetype: media.mime || 'image/jpeg', caption }, opts);
            } else if (sendType === 'video') {
                sent = await sockRef.sendMessage(toJid, { video: buf, mimetype: media.mime || 'video/mp4', caption, gifPlayback: !!media.gif }, opts);
            } else if (sendType === 'audio') {
                sent = await sockRef.sendMessage(toJid, { audio: buf, mimetype: media.mime || 'audio/mp4', ptt: !!media.ptt }, opts);
            } else if (sendType === 'sticker') {
                sent = await sockRef.sendMessage(toJid, { sticker: buf, mimetype: media.mime || 'image/webp' }, opts);
            } else if (sendType === 'document') {
                sent = await sockRef.sendMessage(toJid, { document: buf, mimetype: media.mime || 'application/octet-stream', fileName: media.fileName || 'arquivo', caption }, opts);
            } else {
                return { ok: false, error: 'Tipo de mídia não suportado: ' + sendType };
            }
        } catch (sendErr) {
            console.error('❌ Falha ao enviar mídia via dashboard:', sendErr);
            return { ok: false, error: sendErr.message || 'Falha no envio' };
        }
    } else {
        sent = await sockRef.sendMessage(toJid, { text: String(text).slice(0, 4096) }, opts);
    }

    const sentId = sent && sent.key && sent.key.id;
    log('action', await getGroupName(toJid),
        hasMedia ? `📤 Mídia${hasText ? ' + texto' : ''} via dashboard` : `📤 Resposta via dashboard: ${text}`,
        'Você', sockRef.user?.id?.split(':')[0] || 'bot', null,
        { toJid, messageId: sentId, senderJid: sockRef.user?.id, fromMe: true });

    return { ok: true, messageId: sentId };
}

async function sendDirect(payload) {
    if (!sockRef) return { ok: false, error: 'Bot não conectado' };
    const { toJid, text, media } = payload || {};
    if (!toJid) return { ok: false, error: 'Dados incompletos' };

    const hasText = !!(text && String(text).trim().length > 0);
    const hasMedia = !!(media && media.dataBase64 && (media.type || media.sendType));
    if (!hasText && !hasMedia) return { ok: false, error: 'Mensagem vazia' };

    try {
        const sent = hasMedia
            ? await sendMediaMessage(toJid, hasText ? text : '', media)
            : await sockRef.sendMessage(toJid, { text: String(text).slice(0, 4096) });
        if (sent?.ok === false) return sent;
        const sentId = sent && sent.key && sent.key.id;
        await logSentMessage(toJid, hasText ? text : '', hasMedia ? media : null, sentId);
        return { ok: true, messageId: sentId };
    } catch (sendErr) {
        console.error('Falha ao enviar via dashboard:', sendErr);
        return { ok: false, error: sendErr.message || 'Falha no envio' };
    }

    let sent;
    try {
        if (hasMedia) {
            const buf = Buffer.from(media.dataBase64, 'base64');
            const caption = hasText ? String(text).slice(0, 1024) : undefined;
            const sendType = media.type || media.sendType;
            if (sendType === 'image') sent = await sockRef.sendMessage(toJid, { image: buf, mimetype: media.mime || 'image/jpeg', caption });
            else if (sendType === 'video') sent = await sockRef.sendMessage(toJid, { video: buf, mimetype: media.mime || 'video/mp4', caption, gifPlayback: !!media.gif });
            else if (sendType === 'audio') sent = await sockRef.sendMessage(toJid, { audio: buf, mimetype: media.mime || 'audio/mp4', ptt: !!media.ptt });
            else if (sendType === 'sticker') sent = await sockRef.sendMessage(toJid, { sticker: buf, mimetype: media.mime || 'image/webp' });
            else if (sendType === 'document') sent = await sockRef.sendMessage(toJid, { document: buf, mimetype: media.mime || 'application/octet-stream', fileName: media.fileName || 'arquivo', caption });
            else return { ok: false, error: 'Tipo não suportado: ' + sendType };
        } else {
            sent = await sockRef.sendMessage(toJid, { text: String(text).slice(0, 4096) });
        }
    } catch (sendErr) {
        console.error('❌ Falha ao enviar via dashboard:', sendErr);
        return { ok: false, error: sendErr.message || 'Falha no envio' };
    }

    return { ok: true, messageId: sent && sent.key && sent.key.id };
}

async function getGroupName(jid) {
    if (!sockRef || !jid?.endsWith('@g.us')) return jid;
    try { return (await sockRef.groupMetadata(jid))?.subject || jid; } catch (_) { return jid; }
}

function log(type, group, text, name = null, phone = null, media = null, extra = {}) {
    const logData = {
        type,
        group: group || 'Sistema',
        text,
        name,
        phone,
        media,
        timestamp: Date.now(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        toJid: extra.toJid || null,
        messageId: extra.messageId || null,
        quoted: extra.quoted || null,
        hidden: !!extra.hidden,
        ephemeral: !!extra.ephemeral,
        senderJid: extra.senderJid || null,
        fromMe: !!extra.fromMe
    };

    if (logData.fromMe && logData.messageId && (type === 'chat' || type === 'viewonce')) {
        const existing = dashboardLogs.findIndex(item =>
            item.fromMe &&
            item.messageId === logData.messageId &&
            item.toJid === logData.toJid &&
            item.type === logData.type
        );
        if (existing >= 0) return;
    }

    dashboardLogs.push(logData);
    if (dashboardLogs.length > MAX_LOGS) dashboardLogs.shift();
    if (ioServer) ioServer.emit('msg', logData);
}

let htmlTemplate = null;
function getHtml(botName) {
    if (!htmlTemplate) {
        htmlTemplate = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    }
    const safeName = String(botName || 'Bot');
    return htmlTemplate
        .replaceAll('{{BOT_NAME}}', safeName)
        .replaceAll('{{BOT_NAME_ENCODED}}', encodeURIComponent(safeName));
}

module.exports = { init, log, attachSock, cacheMedia };
