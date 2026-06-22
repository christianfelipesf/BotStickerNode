const axios = require('axios');
const {
    readConfig,
    listNewsGroups,
    getNewsState,
    setNewsState
} = require('../database/utils');

const STATE_KEY = 'lastSeenPostIds';
const HTTP_TIMEOUT_MS = 20 * 1000;

let sockRef = null;
let pollTimer = null;
let running = false;

function attachSock(sock) { sockRef = sock; }

function buildHeaders(userAgent) {
    return {
        'User-Agent': String(userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'),
        'Accept': 'application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8'
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

function decodeEntities(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
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
    const blockRe = (xml.includes('<entry')) ? entryRe : itemRe;

    let m;
    while ((m = blockRe.exec(xml)) !== null) {
        const body = m[1];
        const idRaw = extractAttr(body, 'id') || extractAttr(body, 'guid') || '';
        const title = stripHtml((body.match(/<title[\s>]([\s\S]*?)<\/title>/i) || [])[1] || '');
        const authorRaw = (body.match(/<author[\s>][\s\S]*?<name>([\s\S]*?)<\/name>/i) || [])[1] || '';
        const author = stripHtml(authorRaw).replace(/^\/u\//, '');
        const link = extractAttr(body, 'href') || stripHtml((body.match(/<link[\s\S]*?\/?>(?:[\s\S]*?<\/link>)?/i) || [])[0] || '');
        const updated = stripHtml((body.match(/<updated>([\s\S]*?)<\/updated>/i) || [])[1] || '');
        const published = stripHtml((body.match(/<(?:published|pubDate)>([\s\S]*?)<\/(?:published|pubDate)>/i) || [])[1] || '');

        const id = idFromRedditUrl(link) || stripHtml(idRaw);
        if (!id) continue;

        const media = extractMedia(body);
        const selftext = extractSelftext(body);

        items.push({
            id,
            title,
            selftext,
            author: author ? `u/${author}` : '',
            url: link,
            permalink: link.startsWith('http') ? link : `https://www.reddit.com${link}`,
            updated,
            published,
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
    let externalLink = '';

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

    // Se o [link] é uma GIF direta (i.redd.it/xxx.gif) mas o <img> aponta para preview webp,
    // usar a GIF direta como directImage para que isGifUrl retorne true.
    if (directImage && !/\.gif(\?|$|&)/i.test(directImage) && /\.(gif)(\?|$|&)/i.test(thumbnail)) {
        directImage = thumbnail;
    }

    return {
        thumbnail,
        image: directImage || thumbnail,
        video: directVideo,
        externalLink
    };
}

function extractSelftext(body) {
    const contentMatch = body.match(/<content[^>]*type\s*=\s*"html"[^>]*>([\s\S]*?)<\/content>/i);
    if (!contentMatch) return '';
    const decoded = decodeEntities(contentMatch[1]);

    // O selftext fica DEPOIS do bloco <table>...<img>...</table> e DEPOIS do "submitted by".
    // Estratégia: pegar tudo após "</table>" e limpar.
    const afterTable = decoded.split(/<\/table>/i).slice(1).join('</table>') || decoded;

    // Remover tags, mas preservar quebras de parágrafo (<p>) e listas
    let text = afterTable
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
        .replace(/<\/(ul|ol)>\s*<li[^>]*>/gi, '\n• ')
        .replace(/<\/?(ul|ol|li|p|div|span)[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#32;/g, ' ')
        .replace(/\u00a0/g, ' ');

    // Limpar lixo: " submitted by ", "[link]", "[comments]", " /u/USER ", etc.
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

    // Limite razoável para não estourar a caption do WhatsApp (que tem limite)
    if (text.length > 800) {
        text = text.slice(0, 797) + '...';
    }
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
    // Detecta .gif mesmo se tiver auto=webp ou outros query params depois
    // Ex: https://preview.redd.it/abc.gif?width=640&auto=webp&s=...
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

async function sendPostToGroup(sock, jid, post, sub) {
    const caption = buildCaption(post, sub);
    const cfg = readConfig();
    const media = post.media || {};

    if (media.video && isVideoUrl(media.video)) {
        try {
            const dl = await downloadToBuffer(media.video, cfg.newsUserAgent);
            if (dl && dl.buffer && dl.buffer.length > 0) {
                await sock.sendMessage(jid, {
                    video: dl.buffer,
                    mimetype: dl.mime || 'video/mp4',
                    caption
                });
                return;
            }
        } catch (e) {
            console.error(`📰 [news] falha vídeo r/${sub}:`, e.message);
        }
    }

    if (media.image) {
        try {
            const dl = await downloadToBuffer(media.image, cfg.newsUserAgent);
            if (dl && dl.buffer && dl.buffer.length > 0) {
                const isGif = isGifUrl(media.image) || (dl.mime && dl.mime.toLowerCase().includes('gif'));
                if (isGif) {
                    await sock.sendMessage(jid, {
                        video: dl.buffer,
                        mimetype: 'video/mp4',
                        gifPlayback: true,
                        caption
                    });
                } else {
                    await sock.sendMessage(jid, {
                        image: dl.buffer,
                        mimetype: dl.mime || 'image/jpeg',
                        caption
                    });
                }
                return;
            }
        } catch (e) {
            console.error(`📰 [news] falha imagem r/${sub}:`, e.message);
        }
    }

    const fallback = `${caption}\n\n🔗 ${post.permalink || post.url || ''}`.trim();
    await sock.sendMessage(jid, { text: fallback });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRateLimitError(err) {
    const msg = String((err && (err.message || err.output?.statusMessage)) || err || '').toLowerCase();
    return msg.includes('rate') || msg.includes('overlimit') || msg.includes('429') || msg.includes('too many');
}

async function sendWithRetry(sock, jid, payload, opts = {}) {
    const retries = Math.max(0, Number(opts.retries) || 0);
    const baseDelay = Math.max(500, Number(opts.retryDelayMs) || 3000);
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await sock.sendMessage(jid, payload);
        } catch (e) {
            lastErr = e;
            if (!isRateLimitError(e) || attempt >= retries) throw e;
            const wait = baseDelay * (attempt + 1);
            console.error(`📰 [news] rate-limit em ${jid}, aguardando ${Math.round(wait / 1000)}s antes de retentar (${attempt + 1}/${retries})`);
            await sleep(wait);
        }
    }
    throw lastErr;
}

async function sendPostToGroup(sock, jid, post, sub, retries, retryBaseDelayMs) {
    const showMeta = !!(readConfig().newsShowMeta);
    const caption = buildCaption(post, sub, showMeta);
    const cfg = readConfig();
    const media = post.media || {};

    if (media.video && isVideoUrl(media.video)) {
        try {
            const dl = await downloadToBuffer(media.video, cfg.newsUserAgent);
            if (dl && dl.buffer && dl.buffer.length > 0) {
                const payload = { video: dl.buffer, mimetype: dl.mime || 'video/mp4' };
                if (caption) payload.caption = caption;
                await sendWithRetry(sock, jid, payload, { retries, retryDelayMs: retryBaseDelayMs });
                return;
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
                    await sendWithRetry(sock, jid, payload, { retries, retryDelayMs: retryBaseDelayMs });
                } else if (urlIsGif || bufferIsGif) {
                    const payload = { video: dl.buffer, mimetype: 'video/mp4', gifPlayback: true };
                    if (caption) payload.caption = caption;
                    await sendWithRetry(sock, jid, payload, { retries, retryDelayMs: retryBaseDelayMs });
                } else {
                    const payload = { image: dl.buffer, mimetype: dl.mime || 'image/jpeg' };
                    if (caption) payload.caption = caption;
                    await sendWithRetry(sock, jid, payload, { retries, retryDelayMs: retryBaseDelayMs });
                }
                return;
            }
        } catch (e) {
            console.error(`📰 [news] falha imagem r/${sub}:`, e.message);
        }
    }

    if (caption && showMeta) {
        await sendWithRetry(sock, jid, { text: caption }, { retries, retryDelayMs: retryBaseDelayMs });
    }
}

async function pollOnce() {
    if (running) return;
    if (!sockRef) return;
    const groups = listNewsGroups();
    if (groups.length === 0) {
        console.log('📰 [news] nenhum grupo com feed ativado.');
        return;
    }

    const cfg = readConfig();
    const subs = dedupeSubreddits(cfg.newsSubreddits);
    if (subs.length === 0) {
        console.log('📰 [news] nenhum subreddit configurado.');
        return;
    }

    const sendDelayMs = Math.max(0, Number(cfg.newsSendDelayMs) || 5000);
    const maxPerCycle = Math.max(1, Number(cfg.newsMaxPerCycle) || 1);
    const retries = Math.max(0, Number(cfg.newsMaxRetries) || 3);
    const retryBaseDelayMs = Math.max(1000, Number(cfg.newsRetryBaseDelayMs) || 15000);

    running = true;
    try {
        const lastSeen = getNewsState(STATE_KEY, {}) || {};
        const isFirstBoot = !lastSeen.__bootInitialized;
        const newSeen = { ...lastSeen, __bootInitialized: lastSeen.__bootInitialized || Date.now() };
        let totalAttempted = 0;
        let totalSent = 0;

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
            const fresh = posts.filter(p => p && p.id && !known.has(p.id));

            if (fresh.length === 0) continue;

            const batch = isFirstBoot ? fresh.slice(0, maxPerCycle) : fresh;

            console.log(`📰 [news] r/${sub}: ${fresh.length} novo(s), enviando ${batch.length} neste ciclo.`);

            for (const post of [...batch].reverse()) {
                newSeen[sub] = [...(newSeen[sub] || []), post.id].slice(-200);
                let subSuccess = 0;
                for (const jid of groups) {
                    totalAttempted++;
                    try {
                        await sendPostToGroup(sockRef, jid, post, sub, retries, retryBaseDelayMs);
                        totalSent++;
                        subSuccess++;
                    } catch (e) {
                        console.error(`📰 [news] erro ao enviar ${post.id} para ${jid}:`, e.message);
                    }
                    if (sendDelayMs > 0) await sleep(sendDelayMs);
                }
                if (subSuccess === 0 && groups.length > 0) {
                    const backoff = retryBaseDelayMs * 2;
                    console.error(`📰 [news] todas as tentativas falharam; aguardando ${Math.round(backoff / 1000)}s antes de continuar.`);
                    await sleep(backoff);
                }
            }

            setNewsState(STATE_KEY, newSeen);

            if (isFirstBoot && fresh.length > batch.length) {
                console.log(`📰 [news] r/${sub}: ${fresh.length - batch.length} post(s) restante(s) ignorado(s) (primeira execução, limite=${maxPerCycle}).`);
            }
        }

        if (totalSent > 0) {
            console.log(`📰 [news] ${totalSent} post(s) enviado(s) com sucesso de ${totalAttempted} tentativa(s).`);
        } else if (totalAttempted === 0) {
            console.log(`📰 [news] nenhum post novo.`);
        } else {
            console.log(`📰 [news] ${totalAttempted} tentativa(s) de envio, todas falharam (provável rate-limit).`);
        }
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
    }, 20 * 1000);
    console.log(`📰 [news] polling ativado a cada ${Math.round(ms / 1000)}s`);
}

function stop() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

module.exports = { attachSock, start, stop, pollOnce };
