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

let _rateLimitedUntil = 0;
let _consecutiveRateLimits = 0;
const _subCooldownUntil = new Map();

async function fetchSubredditFeed(sub, userAgent) {
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss`;
    try {
        const res = await axios.get(url, {
            timeout: HTTP_TIMEOUT_MS,
            headers: buildHeaders(userAgent),
            responseType: 'text',
            validateStatus: () => true,
            transformResponse: [(data) => data]
        });
        if (res.status === 429 || res.status === 503) {
            const ra = parseInt(res.headers && res.headers['retry-after'], 10);
            const baseWait = (Number.isFinite(ra) && ra > 0 ? ra : 120);
            _consecutiveRateLimits++;
            const waitMs = baseWait * Math.min(8, Math.pow(2, _consecutiveRateLimits - 1)) * 1000;
            _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + waitMs);
            const prev = _subCooldownUntil.get(sub) || 0;
            const subUntil = Date.now() + waitMs;
            if (subUntil > prev) _subCooldownUntil.set(sub, subUntil);
            console.error(`📰 [news] r/${sub} feed respondeu status=${res.status} → aguardando ${Math.round(waitMs / 1000)}s (tentativa #${_consecutiveRateLimits})`);
            return { __rateLimited: true, items: [] };
        }
        if (res.status !== 200 || !res.data) {
            console.error(`📰 [news] r/${sub} feed respondeu status=${res.status}`);
            return { __rateLimited: false, items: [] };
        }
        _consecutiveRateLimits = 0;
        _subCooldownUntil.delete(sub);
        return { __rateLimited: false, items: parseRssItems(String(res.data)) };
    } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('429') || msg.includes('rate')) {
            _consecutiveRateLimits++;
            const waitMs = 120 * Math.min(8, Math.pow(2, _consecutiveRateLimits - 1)) * 1000;
            _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + waitMs);
            const prev = _subCooldownUntil.get(sub) || 0;
            const subUntil = Date.now() + waitMs;
            if (subUntil > prev) _subCooldownUntil.set(sub, subUntil);
            return { __rateLimited: true, items: [] };
        }
        throw e;
    }
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
    const maxRetries = Math.max(0, Number(cfg.newsMaxRetries) || 3);
    const retryBaseDelayMs = Math.max(1000, Number(cfg.newsRetryBaseDelayMs) || 15000);
    const retryOpts = {
        maxRetries,
        baseDelayMs: retryBaseDelayMs,
        onRetry: (n, wait) => console.warn(`📰 [news] rate-limit r/${sub} → ${jid} tentativa ${n}, aguardando ${wait}ms`)
    };

    await new Promise(resolve => setImmediate(resolve));
    if (Date.now() < _rateLimitedUntil) {
        console.log(`📰 [news] pulando envio para ${jid} (rate-limit global ativo).`);
        return;
    }

    if (media.video && isVideoUrl(media.video)) {
        try {
            const dl = await downloadToBuffer(media.video, cfg.newsUserAgent);
            if (dl && dl.buffer && dl.buffer.length > 0) {
                const payload = { video: dl.buffer, mimetype: dl.mime || 'video/mp4' };
                if (caption) payload.caption = caption;
                return await sendMessageSafe(sock, jid, payload, retryOpts);
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
                    return await sendMessageSafe(sock, jid, payload, retryOpts);
                } else if (urlIsGif || bufferIsGif) {
                    const payload = { video: dl.buffer, mimetype: 'video/mp4', gifPlayback: true };
                    if (caption) payload.caption = caption;
                    return await sendMessageSafe(sock, jid, payload, retryOpts);
                } else {
                    const payload = { image: dl.buffer, mimetype: dl.mime || 'image/jpeg' };
                    if (caption) payload.caption = caption;
                    return await sendMessageSafe(sock, jid, payload, retryOpts);
                }
            }
        } catch (e) {
            console.error(`📰 [news] falha imagem r/${sub}:`, e.message);
        }
    }

    if (caption && showMeta) {
        return await sendMessageSafe(sock, jid, { text: caption }, retryOpts);
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
            if (Date.now() < _rateLimitedUntil) {
                console.log(`📰 [news] fila pausada por rate-limit; limpando backlog (${sendQueue.length} itens).`);
                sendQueue.length = 0;
                break;
            }

            const { post, sub } = sendQueue.shift();

            const cfg = readConfig();
            const groups = listNewsGroups().filter(jid => isNewsEnabled(jid));
            if (groups.length === 0) {
                continue;
            }

            const showMeta = !!cfg.newsShowMeta;
            const sendDelayMs = Math.max(0, Number(cfg.newsSendDelayMs) || 5000);

            if (Date.now() < _rateLimitedUntil) break;

            for (const jid of groups) {
                if (isShuttingDown) break;
                if (!isNewsEnabled(jid)) continue;
                if (Date.now() < _rateLimitedUntil) break;

                try {
                    await sendOne(sockRef, jid, post, sub, showMeta);
                } catch (e) {
                    const msg = String(e?.message || e || '').toLowerCase();
                    if (msg.includes('rate') || msg.includes('overlimit') || msg.includes('429')) {
                        _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + 120 * 1000);
                        console.error(`📰 [news] rate-limit em ${jid}; cooldown 120s.`);
                        break;
                    } else {
                        console.error(`📰 [news] erro ao enviar ${post.id} para ${jid}:`, e?.message || e);
                    }
                }

                if (sendDelayMs > 0) await sleep(sendDelayMs);
            }

            await new Promise(resolve => setImmediate(resolve));
        }
    } finally {
        isProcessing = false;
    }
}

async function pollOnce() {
    if (isShuttingDown || !sockRef) return;

    if (Date.now() < _rateLimitedUntil) {
        const wait = Math.round((_rateLimitedUntil - Date.now()) / 1000);
        console.log(`📰 [news] em cooldown (rate-limit) por mais ${wait}s — pulando poll.`);
        return;
    }

    const cfg = readConfig();
    const subs = dedupeSubreddits(cfg.newsSubreddits);
    if (subs.length === 0) return;

    const groups = listNewsGroups().filter(jid => isNewsEnabled(jid));
    if (groups.length === 0) {
        console.log('📰 [news] nenhum grupo com feed ativado.');
        return;
    }

    const randomMode = !!cfg.newsRandomSub;
    const showMeta = !!cfg.newsShowMeta;
    const sendDelayMs = Math.max(0, Number(cfg.newsSendDelayMs) || 5000);

    const lastSeen = getNewsState(STATE_KEY, {}) || {};

    // Subreddits a consultar neste ciclo.
    // newsRandomSub = false → todos os configurados (padrão).
    // newsRandomSub = true  → sorteia 1 sub por ciclo.
    let subsToCheck = subs;
    if (randomMode && subs.length > 1) {
        subsToCheck = [subs[Math.floor(Math.random() * subs.length)]];
    }

    for (const sub of subsToCheck) {
        if (Date.now() < _rateLimitedUntil) break;

        // Cooldown por sub: pula este e tenta o próximo.
        const subCooldown = _subCooldownUntil.get(sub) || 0;
        if (Date.now() < subCooldown) {
            const wait = Math.round((subCooldown - Date.now()) / 1000);
            console.log(`📰 [news] r/${sub}: em cooldown por mais ${wait}s — pulando.`);
            continue;
        }

        let result = { __rateLimited: false, items: [] };
        try {
            result = await fetchSubredditFeed(sub, cfg.newsUserAgent);
        } catch (e) {
            console.error(`📰 [news] falha ao buscar feed r/${sub}:`, e.message);
            continue;
        }
        if (result.__rateLimited) continue;
        const posts = result.items;
        if (!posts || posts.length === 0) continue;

        // SEMPRE pega o ÚLTIMO (primeiro do feed /new).
        const latest = posts[0];
        if (!latest || !latest.id) continue;

        // lastSeen[sub] agora guarda **um único ID** (o último publicado).
        // Se for igual ao atual, não republica.
        const previousId = lastSeen[sub] || null;
        if (previousId === latest.id) {
            console.log(`📰 [news] r/${sub}: sem post novo (último já postado: ${latest.id}).`);
            continue;
        }

        // Persiste o ID **antes** de enviar. Assim, mesmo se o envio falhar
        // (rate-limit, queda do bot), o próximo poll não vai republicar o mesmo.
        lastSeen[sub] = latest.id;
        setNewsState(STATE_KEY, lastSeen);

        console.log(`📰 [news] r/${sub}: novo último post ${latest.id} — publicando.`);

        for (const jid of groups) {
            if (isShuttingDown) break;
            if (!isNewsEnabled(jid)) continue;
            if (Date.now() < _rateLimitedUntil) {
                console.log(`📰 [news] envio pausado por rate-limit global.`);
                break;
            }

            try {
                await sendOne(sockRef, jid, latest, sub, showMeta);
            } catch (e) {
                const msg = String(e?.message || e || '').toLowerCase();
                if (msg.includes('rate') || msg.includes('overlimit') || msg.includes('429')) {
                    _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + 120 * 1000);
                    console.error(`📰 [news] rate-limit em ${jid}; cooldown 120s.`);
                    break;
                } else {
                    console.error(`📰 [news] erro ao enviar ${latest.id} para ${jid}:`, e?.message || e);
                }
            }

            if (sendDelayMs > 0) await sleep(sendDelayMs);
        }

        await new Promise(resolve => setImmediate(resolve));
    }
}

function parseIntervalMs(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 5 * 60 * 1000;
    if (n < 1000) return n * 1000;
    return n;
}

function start() {
    stop();
    isShuttingDown = false;
    sendQueue.length = 0;
    isProcessing = false;
    const cfg = readConfig();
    const ms = Math.max(60 * 1000, parseIntervalMs(cfg.newsPollIntervalMs));
    pollTimer = setInterval(() => {
        pollOnce().catch(err => console.error('📰 [news] poll:', err?.message || err));
    }, ms);
    if (pollTimer.unref) pollTimer.unref();
    setTimeout(() => {
        pollOnce().catch(err => console.error('📰 [news] initial poll:', err?.message || err));
    }, 20 * 1000);
    console.log(`📰 [news] polling ativado a cada ${Math.round(ms / 1000)}s (subs: ${(cfg.newsSubreddits || []).join(', ')})`);
}

function stop() {
    isShuttingDown = true;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

module.exports = { attachSock, start, stop, pollOnce };
