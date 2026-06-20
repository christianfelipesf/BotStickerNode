const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { mediaToSticker } = require('../database/utils');

let ioServer = null;
let sockRef = null;
let groupsApi = null;
const dashboardLogs = []; // RAM
const MAX_LOGS = 500;
const groupInfoCache = new Map();
const GROUP_INFO_TTL = 60 * 1000;
let groupsRefreshTimer = null;

const mediaCache = new Map();
const MAX_CACHE = 60;

function safe(fn, fallback) {
    try { return fn(); } catch (e) { console.error('[dashboard]', e?.message || e); return fallback; }
}

function cacheMedia(messageId, info) {
    if (!messageId) return;
    try {
        mediaCache.set(messageId, info);
        if (mediaCache.size > MAX_CACHE) {
            const firstKey = mediaCache.keys().next().value;
            if (firstKey) mediaCache.delete(firstKey);
        }
    } catch (_) {}
}

function getCachedMedia(messageId) {
    try { return messageId ? mediaCache.get(messageId) : null; } catch (_) { return null; }
}

function attachSock(sock) {
    sockRef = sock;
    groupInfoCache.clear();
}

function setGroupsApi(api) { groupsApi = api; }

function isValidGroupJid(jid) {
    return typeof jid === 'string'
        && jid.endsWith('@g.us')
        && /^(\d{10,}|\d{5,}-\d{5,})@g\.us$/.test(jid);
}

function fallbackGroupSubject(jid) {
    const id = String(jid || '').split('@')[0];
    return id ? `Grupo ${id.slice(-6)}` : 'Grupo';
}

function normalizeGroupItem(item) {
    const jid = typeof item === 'string' ? item : item?.jid;
    if (!isValidGroupJid(jid)) return null;
    return {
        jid,
        subject: typeof item === 'object' ? item.subject : null,
        pictureUrl: typeof item === 'object' ? item.pictureUrl : null
    };
}

function rememberGroupInfo(jid, patch = {}) {
    const base = normalizeGroupItem({ jid });
    if (!base) return;
    const cached = groupInfoCache.get(base.jid)?.info || {};
    const info = {
        jid: base.jid,
        subject: patch.subject || cached.subject || null,
        pictureUrl: patch.pictureUrl || cached.pictureUrl || null
    };
    groupInfoCache.set(base.jid, { info, updatedAt: Date.now() });
}

async function getParticipatingGroup(jid) {
    if (!sockRef?.groupFetchAllParticipating) return null;
    try {
        const all = await sockRef.groupFetchAllParticipating();
        return all?.[jid] || null;
    } catch (_) {
        return null;
    }
}

async function getGroupInfo(item, force = false) {
    const base = normalizeGroupItem(item);
    if (!base) return null;

    const cached = groupInfoCache.get(base.jid);
    if (!force && cached && Date.now() - cached.updatedAt < GROUP_INFO_TTL) {
        return {
            ...base,
            ...cached.info,
            subject: cached.info.subject || base.subject || fallbackGroupSubject(base.jid),
            pictureUrl: cached.info.pictureUrl || base.pictureUrl || null
        };
    }

    const info = {
        jid: base.jid,
        subject: base.subject || fallbackGroupSubject(base.jid),
        pictureUrl: base.pictureUrl || null
    };

    if (sockRef) {
        try {
            const meta = await sockRef.groupMetadata(base.jid);
            if (meta?.subject) info.subject = meta.subject;
        } catch (_) {}
        if (info.subject === fallbackGroupSubject(base.jid) || !info.subject) {
            const participating = await getParticipatingGroup(base.jid);
            if (participating?.subject) info.subject = participating.subject;
        }
        try {
            const url = await sockRef.profilePictureUrl(base.jid, 'image');
            if (url) info.pictureUrl = url;
        } catch (_) {}
    }

    groupInfoCache.set(base.jid, { info, updatedAt: Date.now() });
    return info;
}

async function getGroupsSnapshot(options = {}) {
    const raw = groupsApi ? await groupsApi() : [];
    const items = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    const out = [];

    for (const item of items) {
        const base = normalizeGroupItem(item);
        if (!base || seen.has(base.jid)) continue;
        seen.add(base.jid);
        const info = await getGroupInfo(base, !!options.force);
        if (info) out.push(info);
    }

    return out.sort((a, b) => String(a.subject).localeCompare(String(b.subject), 'pt-BR'));
}

function init(config) {
    if (config && config.dashboardEnabled === false) return null;

    const port = (config && config.dashboardPort) || 3000;
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
    app.get('/api/groups', async (req, res) => {
        try {
            const list = await getGroupsSnapshot();
            res.json({ ok: true, groups: list });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    app.get('/api/health', (req, res) => res.json({ ok: !!sockRef }));
    app.use('/api', (req, res) => res.status(404).json({ ok: false, error: `Endpoint nao encontrado: ${req.path}` }));
    app.get('/dashboard.css', (req, res) => res.type('css').sendFile(path.join(__dirname, 'dashboard.css')));
    app.get('/dashboard-client.js', (req, res) => res.type('javascript').sendFile(path.join(__dirname, 'dashboard-client.js')));
    app.get('/favicon.ico', (req, res) => {
        console.log('[FAVICON] Requisição recebida em /favicon.ico');
        const ico = path.join(__dirname, 'src', 'media', 'favcon.png');
        if (fs.existsSync(ico)) return res.sendFile(ico);
        res.status(204).end();
    });
    app.get('/', (req, res) => res.type('html').send(getHtml(config.botName || 'Bot')));
    app.use((err, req, res, next) => {
        const status = err?.type === 'entity.too.large' ? 413 : 400;
        const error = status === 413 ? 'Arquivo muito grande para enviar pelo dashboard' : 'JSON invalido';
        res.status(status).json({ ok: false, error });
    });

    ioServer = new Server(server);
    ioServer.on('connection', async (socket) => {
        try { socket.emit('history', dashboardLogs.slice()); } catch (_) {}
        try { socket.emit('groups', await getGroupsSnapshot()); } catch (_) {}
    });

    try {
        server.listen(port, '0.0.0.0', () => console.log(`[dashboard] ativo em http://localhost:${port}`));
        groupsRefreshTimer = setInterval(() => {
            pushGroupsSnapshot({ force: true }).catch(() => {});
        }, 60000);
        if (groupsRefreshTimer.unref) groupsRefreshTimer.unref();
    } catch (e) {
        console.error('[dashboard] falha ao iniciar HTTP:', e.message);
    }
    return ioServer;
}

function apiHandler(fn) {
    return async (req, res) => {
        try {
            const r = await fn(req.body || {});
            res.status(r && r.ok ? 200 : 400).json(r);
        } catch (e) {
            res.status(500).json({ ok: false, error: e?.message || 'erro' });
        }
    };
}

function buildQuotedPayload(quotedId, quotedParticipant, cached, fallbackText) {
    let label = fallbackText || 'Mensagem';
    if (cached) {
        if (cached.text) label = cached.text;
        else if (cached.type === 'image') label = '📷 Foto';
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
    try { return (sockRef?.user?.id || sockRef?.user?.jid || 'bot').split(':')[0].split('@')[0]; }
    catch (_) { return 'bot'; }
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
    return { type: sendType, url: `data:${mime};base64,${media.dataBase64}` };
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
    try {
        const mediaInfo = mediaForLog(media);
        const fallbackText = mediaInfo && !text ? `[${getMediaLabel(mediaInfo.type)}]` : '';
        log('chat', await getGroupName(toJid),
            text ? String(text).slice(0, 4096) : fallbackText,
            'Voce', getBotPhone(), mediaInfo,
            { toJid, messageId: sentId, senderJid: sockRef?.user?.id || sockRef?.user?.jid, fromMe: true, quoted });

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
    } catch (e) {
        console.error('[dashboard] logSentMessage:', e.message);
    }
}

async function sendReply(payload) {
    if (!sockRef) return { ok: false, error: 'Bot não conectado' };
    const { toJid, text, quotedId, quotedParticipant, quotedFromMe, quotedText, media } = payload || {};
    if (!toJid) return { ok: false, error: 'Dados incompletos' };

    const hasText = !!(text && String(text).trim().length > 0);
    const hasMedia = !!(media && media.dataBase64 && (media.type || media.sendType));
    if (!hasText && !hasMedia) return { ok: false, error: 'Mensagem vazia' };

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
        console.error('[dashboard] sendReply:', sendErr?.message || sendErr);
        return { ok: false, error: sendErr?.message || 'Falha no envio' };
    }
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
        console.error('[dashboard] sendDirect:', sendErr?.message || sendErr);
        return { ok: false, error: sendErr?.message || 'Falha no envio' };
    }
}

async function getGroupName(jid) {
    if (!sockRef || !jid?.endsWith('@g.us')) return jid;
    const info = await getGroupInfo({ jid }, true);
    return info?.subject || fallbackGroupSubject(jid);
}

function shouldEmit(data) {
    if (!data) return false;
    if (data.fromMe) return true;
    if (data.toJid && data.toJid.endsWith('@g.us')) return true;
    return false;
}

function log(type, group, text, name = null, phone = null, media = null, extra = {}) {
    try {
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
        if (ioServer && shouldEmit(logData)) {
            ioServer.emit('msg', logData);
        }
    } catch (e) {
        console.error('[dashboard] log:', e?.message || e);
    }
}

async function pushGroupsSnapshot(options = {}) {
    if (!ioServer) return;
    try {
        const list = await getGroupsSnapshot(options);
        ioServer.emit('groups', list);
    } catch (e) {
        console.error('[dashboard] pushGroupsSnapshot:', e?.message || e);
    }
}

let htmlTemplate = null;
function getHtml(botName) {
    if (!htmlTemplate) {
        try {
            htmlTemplate = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
        } catch (e) {
            htmlTemplate = '<!doctype html><html><body><h1>dashboard offline</h1></body></html>';
        }
    }
    const safeName = String(botName || 'Bot');
    return htmlTemplate
        .replaceAll('{{BOT_NAME}}', safeName)
        .replaceAll('{{BOT_NAME_ENCODED}}', encodeURIComponent(safeName));
}

module.exports = {
    init, log, attachSock, cacheMedia,
    setGroupsApi, pushGroupsSnapshot, rememberGroupInfo
};
