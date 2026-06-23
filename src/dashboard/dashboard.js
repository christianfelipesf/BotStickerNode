const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const {
    mediaToSticker,
    insertDashboardLog,
    loadDashboardHistory,
    getDashboardLogByMessageId,
    trimDashboardLogs,
    countDashboardLogs,
    updateDashboardLogReactions,
    clearDashboardLogs,
    upsertDashboardGroupInfo,
    getDashboardGroupInfo,
    listDashboardGroupInfos,
    deleteDashboardGroupInfo
} = require('../database/utils');

let ioServer = null;
let sockRef = null;
let groupsApi = null;
let httpServer = null;
const MAX_LOGS = 200;
const HISTORY_SEND_LIMIT = 100;
const groupInfoCache = new Map();
const GROUP_INFO_TTL = 60 * 1000;
let groupsRefreshTimer = null;
let logsTrimTimer = null;

const mediaCache = new Map();
const MAX_CACHE = 30;

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

let processStartTime = Date.now();
let cpuUsage = { user: 0, system: 0 };
let lastCpuSnapshot = null;

function setStartTime(ts) {
    if (Number.isFinite(ts) && ts > 0) processStartTime = ts;
}

function readCpuUsage() {
    const cpus = os.cpus();
    let user = 0, sys = 0, idle = 0, total = 0;
    for (const c of cpus) {
        const t = c.times || {};
        user += t.user || 0;
        sys += t.sys || 0;
        idle += t.idle || 0;
        total += (t.user || 0) + (t.nice || 0) + (t.sys || 0) + (t.idle || 0) + (t.irq || 0);
    }
    if (lastCpuSnapshot && total > lastCpuSnapshot.total) {
        const dTotal = total - lastCpuSnapshot.total;
        const dIdle = idle - lastCpuSnapshot.idle;
        const usedPct = dTotal > 0 ? Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)) : 0;
        cpuUsage = { userPct: usedPct, cores: cpus.length };
    } else {
        cpuUsage = { userPct: 0, cores: cpus.length };
    }
    lastCpuSnapshot = { user, sys, idle, total };
    return cpuUsage;
}

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
        pictureUrl: patch.pictureUrl || cached.pictureUrl || null,
        memberCount: patch.memberCount !== undefined ? patch.memberCount : (cached.memberCount || 0),
        ownerJid: patch.ownerJid || cached.ownerJid || null,
        desc: patch.desc || cached.desc || null
    };
    groupInfoCache.set(base.jid, { info, updatedAt: Date.now() });
    try { upsertDashboardGroupInfo(base.jid, info); } catch (_) {}
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

async function fetchAndCacheGroupMeta(jid) {
    const out = {};
    if (!sockRef) return out;
    try {
        const meta = await sockRef.groupMetadata(jid);
        if (meta) {
            if (meta.subject) out.subject = meta.subject;
            if (typeof meta.size === 'number') out.memberCount = meta.size;
            else if (Array.isArray(meta.participants)) out.memberCount = meta.participants.length;
            if (meta.owner) out.ownerJid = meta.owner;
            else if (meta.subjectOwner) out.ownerJid = meta.subjectOwner;
            if (meta.desc) out.desc = meta.desc;
            else if (meta.description) out.desc = meta.description;
        }
    } catch (_) {}
    try {
        const url = await sockRef.profilePictureUrl(jid, 'image');
        if (url) out.pictureUrl = url;
    } catch (_) {}
    if (!out.subject || out.memberCount === undefined) {
        try {
            const part = await getParticipatingGroup(jid);
            if (part) {
                if (!out.subject && part.subject) out.subject = part.subject;
                if (out.memberCount === undefined && typeof part.size === 'number') out.memberCount = part.size;
                else if (out.memberCount === undefined && Array.isArray(part.participants)) out.memberCount = part.participants.length;
            }
        } catch (_) {}
    }
    return out;
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
            pictureUrl: cached.info.pictureUrl || base.pictureUrl || null,
            memberCount: cached.info.memberCount || 0,
            ownerJid: cached.info.ownerJid || null,
            desc: cached.info.desc || null
        };
    }

    const fromDb = getDashboardGroupInfo(base.jid) || {};
    let info = {
        jid: base.jid,
        subject: base.subject || fromDb.subject || null,
        pictureUrl: base.pictureUrl || fromDb.pictureUrl || null,
        memberCount: fromDb.memberCount || 0,
        ownerJid: fromDb.ownerJid || null,
        desc: fromDb.desc || null
    };

    const needsRefresh = force
        || !info.subject
        || info.memberCount === 0
        || !info.pictureUrl;

    if (needsRefresh) {
        const fresh = await fetchAndCacheGroupMeta(base.jid);
        info = {
            jid: base.jid,
            subject: info.subject || fresh.subject || null,
            pictureUrl: info.pictureUrl || fresh.pictureUrl || null,
            memberCount: fresh.memberCount || info.memberCount || 0,
            ownerJid: info.ownerJid || fresh.ownerJid || null,
            desc: info.desc || fresh.desc || null
        };
    }

    if (!info.subject) info.subject = fallbackGroupSubject(base.jid);

    groupInfoCache.set(base.jid, { info, updatedAt: Date.now() });
    try { upsertDashboardGroupInfo(base.jid, info); } catch (_) {}
    return info;
}

async function getGroupsSnapshot(options = {}) {
    const raw = groupsApi ? await groupsApi() : [];
    const items = Array.isArray(raw) ? raw : [];
    const knownJids = new Set(items.map(i => i?.jid).filter(Boolean));

    try {
        const stored = listDashboardGroupInfos();
        for (const s of stored) {
            if (!knownJids.has(s.jid)) {
                try { deleteDashboardGroupInfo(s.jid); } catch (_) {}
            }
        }
    } catch (_) {}

    const seen = new Set();
    const tasks = [];
    for (const item of items) {
        const base = normalizeGroupItem(item);
        if (!base || seen.has(base.jid)) continue;
        seen.add(base.jid);
        tasks.push(getGroupInfo(base, !!options.force));
    }
    const results = await Promise.all(tasks);
    const out = results.filter(Boolean);
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
    app.get('/api/system', (req, res) => {
        try {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const mem = {
                totalBytes: totalMem,
                usedBytes: usedMem,
                freeBytes: freeMem,
                usedPct: totalMem > 0 ? (usedMem / totalMem) * 100 : 0
            };
            const cpu = readCpuUsage();
            const procMem = process.memoryUsage();
            const proc = {
                rssBytes: procMem.rss || 0,
                heapUsedBytes: procMem.heapUsed || 0,
                heapTotalBytes: procMem.heapTotal || 0
            };
            const upMs = Date.now() - processStartTime;
            const days = Math.floor(upMs / (24 * 3600 * 1000));
            const hrs = Math.floor((upMs % (24 * 3600 * 1000)) / 3600000);
            const mins = Math.floor((upMs % 3600000) / 60000);
            const secs = Math.floor((upMs % 60000) / 1000);
            const uptimeStr = `${days}d ${hrs}h ${mins}m ${secs}s`;

            let totalGroups = 0;
            let activeGroups = 0;
            let partialGroups = 0;
            let totalCommands = 0;
            let totalRestarts = 0;
            try {
                const utils = require('../database/utils');
                totalCommands = (utils.readStats() || {}).totalCommands || 0;
                totalRestarts = (utils.readStats() || {}).restarts || 0;
                const ag = (utils.listActiveGroups() || []).length;
                const pg = (utils.listPartialGroups() || []).length;
                activeGroups = ag;
                partialGroups = pg;
                totalGroups = ag + pg;
            } catch (_) {}

            res.json({
                ok: true,
                host: os.hostname(),
                platform: os.platform(),
                arch: os.arch(),
                cpus: os.cpus().length,
                cpuModel: (os.cpus()[0] || {}).model || 'unknown',
                nodeVersion: process.version,
                pid: process.pid,
                uptimeMs: upMs,
                uptimeStr,
                cpu,
                memory: mem,
                process: proc,
                bot: {
                    connected: !!sockRef,
                    totalGroups,
                    activeGroups,
                    partialGroups,
                    totalCommands,
                    totalRestarts
                }
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    app.use('/api', (req, res) => res.status(404).json({ ok: false, error: `Endpoint nao encontrado: ${req.path}` }));
    app.get('/dashboard.css', (req, res) => res.type('css').sendFile(path.join(__dirname, 'dashboard.css')));
    app.get('/dashboard-client.js', (req, res) => res.type('javascript').sendFile(path.join(__dirname, 'dashboard-client.js')));
    app.get('/favicon.ico', (req, res) => {
        const ico = path.join(__dirname, '..', 'media', 'favcon.png');
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
        try {
            const history = loadDashboardHistory({ limit: HISTORY_SEND_LIMIT });
            socket.emit('history', history);
        } catch (_) {}
        try {
            const quick = await getGroupsSnapshot({ force: false });
            socket.emit('groups', quick);
            socket.emit('groups:ready', true);
            const cachedSet = new Set(quick.map(g => g.jid));
            const items = groupsApi ? await groupsApi() : [];
            const enrichTasks = [];
            for (const item of items) {
                const jid = typeof item === 'string' ? item : item?.jid;
                if (!jid || cachedSet.has(jid)) continue;
                enrichTasks.push(getGroupInfo(jid, false));
            }
            if (enrichTasks.length) {
                Promise.all(enrichTasks).then(async () => {
                    try {
                        ioServer.emit('groups', await getGroupsSnapshot({ force: false }));
                    } catch (_) {}
                }).catch(() => {});
            }
        } catch (_) {}
    });

    try {
        httpServer = server;
        const publicUrl = String(config?.dashboardUrl || '').replace(/\/+$/, '');
        server.listen(port, '0.0.0.0', () => {
            console.log(`[dashboard] ativo em http://localhost:${port}`);
            if (publicUrl) console.log(`[dashboard] url pública: ${publicUrl}`);
        });
        groupsRefreshTimer = setInterval(() => {
            pushGroupsSnapshot({ force: false }).catch(() => {});
        }, 10 * 60 * 1000);
        if (groupsRefreshTimer.unref) groupsRefreshTimer.unref();

        const maxRows = Number(config?.dashboardMaxLogs) || MAX_LOGS;
        const maxAgeMs = (Number(config?.dashboardHistoryHours) || 12) * 3600 * 1000;
        const trimIntervalMs = Math.max(30 * 1000, Number(config?.dashboardTrimIntervalMs) || 5 * 60 * 1000);
        logsTrimTimer = setInterval(() => {
            try {
                const c = countDashboardLogs();
                if (c > maxRows || (maxAgeMs > 0 && c > 0)) {
                    trimDashboardLogs({ maxAgeMs, maxRows });
                }
            } catch (_) {}
        }, trimIntervalMs);
        if (logsTrimTimer.unref) logsTrimTimer.unref();

        try {
            const before = countDashboardLogs();
            if (before > maxRows || (maxAgeMs > 0 && before > 0)) {
                trimDashboardLogs({ maxAgeMs, maxRows });
                const after = countDashboardLogs();
                if (after !== before) {
                    console.log(`🧹 [dashboard] logs: ${before} → ${after} (maxRows=${maxRows}, maxAgeHours=${maxAgeMs/3600000})`);
                }
            }
        } catch (_) {}
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
            fromMe: !!extra.fromMe,
            reactions: extra.reactions || undefined
        };

        try { insertDashboardLog(logData); } catch (_) {}

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
        const now = Date.now();
        const wantsForce = !!options.force;
        const effectiveForce = wantsForce && (now - lastForceRefreshAt > FORCE_REFRESH_COOLDOWN_MS);
        if (wantsForce) lastForceRefreshAt = now;
        const list = await getGroupsSnapshot({ force: effectiveForce });
        ioServer.emit('groups', list);
    } catch (e) {
        console.error('[dashboard] pushGroupsSnapshot:', e?.message || e);
    }
}

function handleReaction(targetId, emoji, senderJid, senderName) {
    try {
        const msg = getDashboardLogByMessageId(targetId);
        let targetJid = null;
        let targetType = null;
        if (msg) {
            if (!msg.reactions) msg.reactions = {};
            if (emoji) {
                msg.reactions[senderJid] = emoji;
            } else {
                delete msg.reactions[senderJid];
            }
            targetJid = msg.toJid;
            targetType = msg.type;
            try { updateDashboardLogReactions(targetJid, targetId, targetType, msg.reactions); } catch (_) {}
        }
        if (ioServer) {
            ioServer.emit('reaction', { targetId, emoji, senderJid, senderName });
        }
    } catch (e) {
        console.error('[dashboard] handleReaction:', e.message);
    }
}

let lastForceRefreshAt = 0;
const FORCE_REFRESH_COOLDOWN_MS = 30 * 60 * 1000;

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

let currentMaxLogs = 200;
function setMaxLogs(n) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) currentMaxLogs = v;
}

function resetDashboard() {
    let removedLogs = 0;
    try { removedLogs = clearDashboardLogs(); } catch (e) { console.error('[dashboard] reset clearLogs:', e.message); }
    try { mediaCache.clear(); } catch (_) {}
    setMaxLogs(200);
    if (ioServer) {
        try { ioServer.emit('reset', { ts: Date.now() }); } catch (_) {}
    }
    return { removedLogs, newLimit: currentMaxLogs };
}

function stop() {
    return new Promise((resolve) => {
        let pending = 0;
        if (ioServer) {
            pending++;
            try { ioServer.close(() => { pending--; if (pending === 0) resolve(); }); } catch (_) { pending--; }
        }
        if (httpServer) {
            pending++;
            try { httpServer.close(() => { pending--; if (pending === 0) resolve(); }); } catch (_) { pending--; }
        }
        if (groupsRefreshTimer) { try { clearInterval(groupsRefreshTimer); groupsRefreshTimer = null; } catch (_) {} }
        if (logsTrimTimer) { try { clearInterval(logsTrimTimer); logsTrimTimer = null; } catch (_) {} }
        ioServer = null;
        httpServer = null;
        if (pending === 0) resolve();
        else setTimeout(resolve, 2000);
    });
}

module.exports = {
    init, log, attachSock, cacheMedia,
    setGroupsApi, pushGroupsSnapshot, rememberGroupInfo,
    setStartTime,
    handleReaction,
    resetDashboard, setMaxLogs, stop
};
