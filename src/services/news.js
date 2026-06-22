const https = require('https');
const axios = require('axios');
const {
    readConfig,
    listNewsGroups,
    getNewsState,
    setNewsState
} = require('../database/utils');

const STATE_KEY = 'lastSeenPostIds';
const REDDIT_TIMEOUT_MS = 15 * 1000;

let sockRef = null;
let pollTimer = null;
let running = false;

function attachSock(sock) { sockRef = sock; }

function httpsAgent() {
    return new https.Agent({ keepAlive: true, maxSockets: 4 });
}

function buildHeaders(userAgent) {
    return {
        'User-Agent': String(userAgent || 'BotStickerNode/1.0'),
        'Accept': 'application/json'
    };
}

function normalizeSubreddit(name) {
    return String(name || '')
        .trim()
        .replace(/^r\//i, '')
        .replace(/^\//, '')
        .replace(/\/$/, '')
        .toLowerCase();
}

function dedupeSubreddits(list) {
    const out = [];
    const seen = new Set();
    for (const raw of (list || [])) {
        const sub = normalizeSubreddit(raw);
        if (!sub || seen.has(sub)) continue;
        seen.add(sub);
        out.push(sub);
    }
    return out;
}

function pickMedia(post) {
    if (!post) return null;
    const url = post.url_overridden_by_dest || post.url || '';
    if (!url) return null;
    const lower = url.toLowerCase();
    const isImage = /\.(jpe?g|png|gif|webp)(\?|$)/i.test(lower) || /i\.redd\.it\//i.test(lower) || /preview\.redd\.it\//i.test(lower);
    const isVideo = /\.(mp4|webm)(\?|$)/i.test(lower) || /v\.redd\.it\//i.test(lower) || /reddit\.com\/video/i.test(lower);
    const isGallery = post.is_gallery === true || (post.media_metadata && Object.keys(post.media_metadata).length > 0);

    if (isVideo) return { kind: 'video', url };
    if (isImage) return { kind: 'image', url };
    if (isGallery) return { kind: 'gallery', url };

    return null;
}

function galleryItems(post) {
    const meta = post.media_metadata;
    if (!meta || typeof meta !== 'object') return [];
    const order = Array.isArray(post.gallery_data?.items) ? post.gallery_data.items : [];
    const items = [];
    for (const entry of order) {
        const id = entry?.media_id;
        if (!id || !meta[id]) continue;
        const m = meta[id];
        const u = (m.s?.u || m.s?.gif || m.s?.mp4 || '').replace(/&amp;/g, '&');
        if (!u) continue;
        const mime = (m.m || '').toLowerCase();
        const kind = mime.includes('mp4') ? 'video' : 'image';
        items.push({ id, url: u, kind });
    }
    return items;
}

async function fetchSubredditNew(sub, userAgent) {
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=10`;
    const res = await axios.get(url, {
        timeout: REDDIT_TIMEOUT_MS,
        headers: buildHeaders(userAgent),
        httpsAgent: httpsAgent(),
        validateStatus: () => true
    });
    if (res.status !== 200 || !res.data) return [];
    const children = res.data?.data?.children;
    if (!Array.isArray(children)) return [];
    return children.map(c => c?.data).filter(Boolean);
}

async function downloadToBuffer(mediaUrl, userAgent) {
    const res = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: REDDIT_TIMEOUT_MS,
        headers: buildHeaders(userAgent),
        httpsAgent: httpsAgent(),
        maxRedirects: 5,
        validateStatus: () => true
    });
    if (res.status < 200 || res.status >= 300 || !res.data) return null;
    const mime = (res.headers && res.headers['content-type']) || '';
    return { buffer: Buffer.from(res.data), mime: String(mime).split(';')[0].trim() };
}

function buildCaption(post, sub) {
    const title = post.title ? String(post.title) : '';
    const author = post.author ? `u/${post.author}` : '';
    const permalink = post.permalink ? `https://reddit.com${post.permalink}` : '';
    const score = typeof post.score === 'number' ? `▲ ${post.score}` : '';
    const comments = typeof post.num_comments === 'number' ? `💬 ${post.num_comments}` : '';
    const meta = [score, comments].filter(Boolean).join(' • ');
    return `📰 *r/${sub}*\n*${title}*\n${author ? `👤 ${author}` : ''}${meta ? `\n${meta}` : ''}${permalink ? `\n🔗 ${permalink}` : ''}`;
}

async function sendPostToGroup(sock, jid, post, sub) {
    const caption = buildCaption(post, sub);
    const gallery = galleryItems(post);
    if (gallery.length > 0) {
        for (let i = 0; i < gallery.length && i < 4; i++) {
            const item = gallery[i];
            try {
                const dl = await downloadToBuffer(item.url, readConfig().newsUserAgent);
                if (!dl || !dl.buffer || !dl.mime) continue;
                const text = i === 0 ? caption : null;
                if (item.kind === 'video' || dl.mime.startsWith('video/')) {
                    await sock.sendMessage(jid, { video: dl.buffer, mimetype: dl.mime || 'video/mp4', caption: text });
                } else {
                    await sock.sendMessage(jid, { image: dl.buffer, mimetype: dl.mime || 'image/jpeg', caption: text });
                }
            } catch (e) {
                console.error(`📰 [news] falha ao enviar item da galeria (r/${sub}):`, e.message);
            }
        }
        return;
    }

    const media = pickMedia(post);
    if (!media) {
        const text = `${caption}\n\n🔗 ${post.url_overridden_by_dest || post.url || ''}`.trim();
        await sock.sendMessage(jid, { text });
        return;
    }

    try {
        const dl = await downloadToBuffer(media.url, readConfig().newsUserAgent);
        if (!dl || !dl.buffer || !dl.mime) {
            await sock.sendMessage(jid, { text: `${caption}\n\n🔗 ${media.url}` });
            return;
        }
        if (media.kind === 'video' || dl.mime.startsWith('video/')) {
            await sock.sendMessage(jid, { video: dl.buffer, mimetype: dl.mime || 'video/mp4', caption });
        } else if (media.kind === 'image' || dl.mime.startsWith('image/')) {
            await sock.sendMessage(jid, { image: dl.buffer, mimetype: dl.mime || 'image/jpeg', caption });
        } else {
            await sock.sendMessage(jid, { text: `${caption}\n\n🔗 ${media.url}` });
        }
    } catch (e) {
        console.error(`📰 [news] falha ao enviar mídia (r/${sub}):`, e.message);
        await sock.sendMessage(jid, { text: `${caption}\n\n🔗 ${media.url}` });
    }
}

async function pollOnce() {
    if (running) return;
    if (!sockRef) return;
    const groups = listNewsGroups();
    if (groups.length === 0) return;

    const cfg = readConfig();
    const subs = dedupeSubreddits(cfg.newsSubreddits);
    if (subs.length === 0) return;

    running = true;
    try {
        const lastSeen = getNewsState(STATE_KEY, {}) || {};
        const newSeen = { ...lastSeen };

        for (const sub of subs) {
            let posts = [];
            try {
                posts = await fetchSubredditNew(sub, cfg.newsUserAgent);
            } catch (e) {
                console.error(`📰 [news] falha ao buscar r/${sub}:`, e.message);
                continue;
            }
            if (posts.length === 0) continue;

            const known = new Set(lastSeen[sub] || []);
            const fresh = posts.filter(p => p && p.id && !known.has(p.id));

            for (const post of fresh.reverse()) {
                newSeen[sub] = [...(newSeen[sub] || []), post.id].slice(-50);
                for (const jid of groups) {
                    try {
                        await sendPostToGroup(sockRef, jid, post, sub);
                    } catch (e) {
                        console.error(`📰 [news] erro ao enviar para ${jid}:`, e.message);
                    }
                }
            }
        }

        setNewsState(STATE_KEY, newSeen);
    } finally {
        running = false;
    }
}

function start() {
    stop();
    const cfg = readConfig();
    const ms = Math.max(60 * 1000, Number(cfg.newsPollIntervalMs) || 5 * 60 * 1000);
    pollTimer = setInterval(() => {
        pollOnce().catch(err => console.error('📰 [news] poll:', err?.message || err));
    }, ms);
    if (pollTimer.unref) pollTimer.unref();
    setTimeout(() => {
        pollOnce().catch(err => console.error('📰 [news] initial poll:', err?.message || err));
    }, 15 * 1000);
    console.log(`📰 [news] polling ativado a cada ${Math.round(ms / 1000)}s`);
}

function stop() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

module.exports = { attachSock, start, stop, pollOnce };
