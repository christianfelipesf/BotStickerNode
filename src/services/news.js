const axios = require('axios');
const {
    readConfig,
    listNewsGroups,
    getNewsState,
    setNewsState,
    isNewsEnabled,
    sendMessageSafe
} = require('../database/utils');

const STATE_KEY = 'lastSeenPostIds';
const HTTP_TIMEOUT_MS = 20 * 1000;

let sockRef = null;
let pollTimer = null;
let isShuttingDown = false;

// Fila serial de envio (processa 1 post por vez)
const sendQueue = [];
let isProcessing = false;

function attachSock(sock) { sockRef = sock; }

function buildHeaders(userAgent) {
    return {
        'User-Agent': String(userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'),
        'Accept': 'application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8'
    };
}

function normalizeSubreddit(name) {
    return String(name || '').trim().replace(/^r\//i, '').replace(/^\//, '').replace(/\/$/, '').toLowerCase();
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

function decodeEntities(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function stripHtml(s) {
    if (s == null) return '';
    return decodeEntities(String(s)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractAttr(tag, attr) {
    const re = new RegExp(`${attr}\\s*=\\s*"([^"]+)"`, 'i');
    const m = String(tag).match(re);
    return m ? decodeEntities(m[1]) : '';
}

function parseRssItems(xml) {
    const items = [];
    const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
    const blockRe = xml.includes('<entry') ? entryRe : itemRe;

    let m;
    while ((m = blockRe.exec(xml)) !== null) {
        const body = m[1];
        const idRaw = extractAttr(body, 'id') || extractAttr(body, 'guid') || '';
        const title = stripHtml((body.match(/<title[\s>]([\s\S]*?)<\/title>/i) || [])[1] || '');
        const link = extractAttr(body, 'href') || stripHtml((body.match(/<link[\s\S]*?\/?>(?:[\s\S]*?<\/link>)?/i) || [])[0] || '');

        const id = idFromRedditUrl(link) || stripHtml(idRaw);
        if (!id) continue;

        const media = extractMedia(body);
        const selftext = extractSelftext(body);

        items.push({
            id,
            title,
            selftext,
            url: link,
            permalink: link.startsWith('http') ? link : `https://www.reddit.com${link}`,
            media
        });
    }
    return items;
}

function idFromRedditUrl(url) {
    if (!url) return '';
    const m = String(url).match(/\/comments\/([a-z0-9]+)/i);
    return m ? m[1] : '';
}

function extractMedia(body) {
    let thumbnail = '';
    let contentHtml = '';
    let directImage = '';
    let directVideo = '';

    const thumbMatch = body.match(/<media:thumbnail[^>]*url\s*=\s*"([^"]+)"/i);
    if (thumbMatch) thumbnail = decodeEntities(thumbMatch[1]);

    const contentMatch = body.match(/<content[^>]*type\s*=\s*"html"[^>]*>([\s\S]*?)<\/content>/i);
    if (contentMatch) contentHtml = decodeEntities(contentMatch[1]);
    if (!contentHtml) {
        const alt = body.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
        if (alt) contentHtml = decodeEntities(alt[1]);
    }

    if (contentHtml) {
        const imgMatch = contentHtml.match(/<img[^>]*src\s*=\s*"([^"]+)"/i);
        if (imgMatch) directImage = decodeEntities(imgMatch[1]);

        const linkRe = /<a[^>]+href\s*=\s*"([^"]+)"[^>]*>\s*\[link\]\s*<\/a>/gi;
        let lm;
        while ((lm = linkRe.exec(contentHtml)) !== null) {
            const u = decodeEntities(lm[1]);
            if (/\.(gif)(\?|$|&)/i.test(u)) directImage = u;
            else if (/\.(jpe?g|png|webp)(\?|$|&)/i.test(u) && !directImage) directImage = u;
            else if (/\.(mp4|webm)(\?|$|&)/i.test(u) && !directVideo) directVideo = u;
        }

        const vidMatch = contentHtml.match(/(https?:\/\/[^\s"'<>]+\.(?:mp4|webm)[^\s"'<>]*)/i);
        if (vidMatch && !directVideo) directVideo = decodeEntities(vidMatch[1]);
    }

    if (directImage && !/\.gif(\?|$|&)/i.test(directImage) && /\.(gif)(\?|$|&)/i.test(thumbnail)) {
        directImage = thumbnail;
    }

    return {
        thumbnail,
        image: directImage || thumbnail,
        video: directVideo
    };
}

function extractSelftext(body) {
    const contentMatch = body.match(/<content[^>]*type\s*=\s*"html"[^>]*>([\s\S]*?)<\/content>/i);
    if (!contentMatch) return '';
    const decoded = decodeEntities(contentMatch[1]);

    const afterTable = decoded.split(/<\/table>/i).slice(1).join('</table>') || decoded;

    let text = afterTable
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
        .replace(/<\/(ul|ol)>\s*<li[^>]*>/gi, '\n• ')
        .replace(/<\/?(ul|ol|li|p|div|span)[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#32;/g, ' ')
        .replace(/\u00a0/g, ' ');

    text = text
        .replace(/\s*submitted by\s*/i, '')
        .replace(/\s*\/?u\/[A-Za-z0-9_\-]+\s*/g, ' ')
        .replace(/\s*\[link\]\s*/gi, ' ')
        .replace(/\s*\[comments\]\s*/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    if (text.length > 800) text = text.slice(0, 797) + '...';
    return text;
}

async function fetchSubredditFeed(sub, userAgent) {
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss`;
    const res = await axios.get(url, {
        timeout: HTTP_TIMEOUT_MS,
        headers: buildHeaders(userAgent),
        responseType: 'text',
        validateStatus: () => true,
        transformResponse: [(data) => data]
    });
    if (res.status !== 200 || !res.data) {
        console.error(`📰 [news] r/${sub} feed respondeu status=${res.status}`);
        return [];
    }
    return parseRssItems(String(res.data));
}

async function downloadToBuffer(mediaUrl, userAgent) {
    const res = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        timeout: HTTP_TIMEOUT_MS,
        headers: { 'User-Agent': buildHeaders(userAgent)['User-Agent'], 'Accept': '*/*' },
        maxRedirects: 5,
        validateStatus: () => true
    });
    if (res.status < 200 || res.status >= 300 || !res.data) return null;
    const mime = (res.headers && res.headers['content-type']) || '';
    return { buffer: Buffer.from(res.data), mime: String(mime).split(';')[0].trim() };
}

function buildCaption(post, sub, showMeta) {
    const title = (post.title || '').trim();
    const selftext = (post.selftext || '').trim();

    if (showMeta) {
        const lines = [];
        if (title) lines.push(`*${title}*`);
        if (selftext) lines.push(selftext);
        const permalink = post.permalink || post.url || '';
        if (permalink) lines.push(permalink);
        return lines.join('\n');
    }

    if (title && selftext) return `*${title}*\n\n${selftext}`;
    return title || selftext || '';
}

function isGifUrl(url) {
    if (!url) return false;
    const u = String(url);
    if (/\/[^./?#]+\.gif(\?|$|#|&)/i.test(u)) return true;
    if (/\.gif(\?|$|&)/i.test(u)) return true;
    return false;
}

function isVideoUrl(url) {
    if (!url) return false;
    const u = String(url);
    if (/\/[^./?#]+\.(mp4|webm)(\?|$|#|&)/i.test(u)) return true;
    if (/\.(mp4|webm)(\?|$|&)/i.test(u)) return true;
    return false;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendOne(sock, jid, post, sub, showMeta) {
    const caption = buildCaption(post, sub, showMeta);
    const cfg = readConfig();
    const media = post.media || {};

    if (media.video && isVideoUrl(media.video)) {
        try {
            const dl = await downloadToBuffer(media.video, cfg.newsUserAgent);
            if (dl && dl.buffer && dl.buffer.length > 0) {
                const payload = { video: dl.buffer, mimetype: dl.mime || 'video/mp4' };
                if (caption) payload.caption = caption;
                return await sendMessageSafe(sock, jid, payload, {
                    maxRetries: 3,
                    onRetry: (n, wait) => console.warn(`📰 [news] rate-limit vídeo r/${sub} → ${jid} tentativa ${n}, aguardando ${wait}ms`)
                });
            }
        } catch (e) {
            console.error(`📰 [news] falha vídeo r/${sub}:`, e.message);
        }
    }

    if (media.image) {
        try {
            const dl = await downloadToBuffer(media.image, cfg.newsUserAgent);
            if (dl && dl.buffer && dl.buffer.length > 0) {
                const mimeLower = (dl.mime || '').toLowerCase();
                const urlIsGif = isGifUrl(media.image);
                const urlIsVideo = isVideoUrl(media.image);
                const bufferIsVideo = mimeLower.startsWith('video/');
                const bufferIsGif = mimeLower === 'image/gif' || (urlIsGif && !mimeLower.startsWith('image/'));

                if (urlIsVideo || bufferIsVideo) {
                    const payload = { video: dl.buffer, mimetype: dl.mime || 'video/mp4' };
                    if (caption) payload.caption = caption;
                    return await sendMessageSafe(sock, jid, payload, {
                        maxRetries: 3,
                        onRetry: (n, wait) => console.warn(`📰 [news] rate-limit r/${sub} → ${jid} tentativa ${n}, aguardando ${wait}ms`)
                    });
                } else if (urlIsGif || bufferIsGif) {
                    const payload = { video: dl.buffer, mimetype: 'video/mp4', gifPlayback: true };
                    if (caption) payload.caption = caption;
                    return await sendMessageSafe(sock, jid, payload, {
                        maxRetries: 3,
                        onRetry: (n, wait) => console.warn(`📰 [news] rate-limit gif r/${sub} → ${jid} tentativa ${n}, aguardando ${wait}ms`)
                    });
                } else {
                    const payload = { image: dl.buffer, mimetype: dl.mime || 'image/jpeg' };
                    if (caption) payload.caption = caption;
                    return await sendMessageSafe(sock, jid, payload, {
                        maxRetries: 3,
                        onRetry: (n, wait) => console.warn(`📰 [news] rate-limit img r/${sub} → ${jid} tentativa ${n}, aguardando ${wait}ms`)
                    });
                }
            }
        } catch (e) {
            console.error(`📰 [news] falha imagem r/${sub}:`, e.message);
        }
    }

    if (caption && showMeta) {
        return await sendMessageSafe(sock, jid, { text: caption }, {
            maxRetries: 3,
            onRetry: (n, wait) => console.warn(`📰 [news] rate-limit texto r/${sub} → ${jid} tentativa ${n}, aguardando ${wait}ms`)
        });
    }
}

// Enfileira um post para envio. Retorna true se enfileirado.
function enqueuePost(post, sub) {
    if (!sockRef) return false;
    sendQueue.push({ post, sub, enqueuedAt: Date.now() });
    scheduleProcessQueue();
    return true;
}

// Processa a fila serialmente com setImmediate entre itens para nunca bloquear
function scheduleProcessQueue() {
    if (isProcessing) return;
    isProcessing = true;
    setImmediate(processQueue);
}

async function processQueue() {
    try {
        while (!isShuttingDown && sendQueue.length > 0 && sockRef) {
            const { post, sub } = sendQueue.shift();

            const cfg = readConfig();
            const groups = listNewsGroups().filter(jid => isNewsEnabled(jid));
            if (groups.length === 0) {
                // Nenhum grupo quer receber; descarta
                continue;
            }

            const showMeta = !!cfg.newsShowMeta;
            const sendDelayMs = Math.max(0, Number(cfg.newsSendDelayMs) || 5000);

            for (const jid of groups) {
                if (isShuttingDown) break;
                if (!isNewsEnabled(jid)) continue;

                try {
                    await sendOne(sockRef, jid, post, sub, showMeta);
                } catch (e) {
                    const msg = String(e?.message || e || '').toLowerCase();
                    if (msg.includes('rate') || msg.includes('overlimit') || msg.includes('429')) {
                        console.error(`📰 [news] rate-limit em ${jid}; aguardando 30s`);
                        await sleep(30000);
                    } else {
                        console.error(`📰 [news] erro ao enviar ${post.id} para ${jid}:`, e?.message || e);
                    }
                }

                if (sendDelayMs > 0) await sleep(sendDelayMs);
            }

            // Marca como visto imediatamente após processar (em vez de depender do envio)
            const lastSeen = getNewsState(STATE_KEY, {}) || {};
            const list = lastSeen[sub] || [];
            if (!list.includes(post.id)) {
                lastSeen[sub] = [...list, post.id].slice(-200);
                if (!lastSeen.__bootInitialized) lastSeen.__bootInitialized = Date.now();
                setNewsState(STATE_KEY, lastSeen);
            }

            // Libera o event loop entre posts
            await new Promise(resolve => setImmediate(resolve));
        }
    } finally {
        isProcessing = false;
    }
}

async function pollOnce() {
    if (isShuttingDown || !sockRef) return;

    const cfg = readConfig();
    const subs = dedupeSubreddits(cfg.newsSubreddits);
    if (subs.length === 0) return;

    const groups = listNewsGroups().filter(jid => isNewsEnabled(jid));
    if (groups.length === 0) {
        console.log('📰 [news] nenhum grupo com feed ativado.');
        return;
    }

    const maxPerCycle = Math.max(1, Number(cfg.newsMaxPerCycle) || 1);

    const lastSeen = getNewsState(STATE_KEY, {}) || {};
    const isFirstBoot = !lastSeen.__bootInitialized;

    // Marca inicialização IMEDIATAMENTE (sem esperar enfileirar)
    if (isFirstBoot) {
        lastSeen.__bootInitialized = Date.now();
        setNewsState(STATE_KEY, lastSeen);
    }

    for (const sub of subs) {
        let posts = [];
        try {
            posts = await fetchSubredditFeed(sub, cfg.newsUserAgent);
        } catch (e) {
            console.error(`📰 [news] falha ao buscar feed r/${sub}:`, e.message);
            continue;
        }
        if (posts.length === 0) continue;

        const known = new Set(lastSeen[sub] || []);
        let fresh = posts.filter(p => p && p.id && !known.has(p.id));
        if (fresh.length === 0) continue;

        // Na primeira execução: enfileira no máx maxPerCycle (descarta o resto)
        // Nas seguintes: enfileira TUDO, mas o processQueue respeita o delay
        const toEnqueue = isFirstBoot ? fresh.slice(0, maxPerCycle) : fresh;

        console.log(`📰 [news] r/${sub}: ${fresh.length} novo(s), enfileirando ${toEnqueue.length}.`);

        for (const post of toEnqueue) {
            enqueuePost(post, sub);
        }

        if (isFirstBoot && fresh.length > toEnqueue.length) {
            console.log(`📰 [news] r/${sub}: ${fresh.length - toEnqueue.length} post(s) restante(s) ignorado(s) (backlog descartado na 1ª execução).`);
        }
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
    }, 20 * 1000);
    console.log(`📰 [news] polling ativado a cada ${Math.round(ms / 1000)}s`);
}

function stop() {
    isShuttingDown = true;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

module.exports = { attachSock, start, stop, pollOnce };
