const axios = require('axios');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
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

function ts() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const newsLog = (...args) => console.log(`📰 [news][${ts()}]`, ...args);
const newsErr = (...args) => console.error(`📰 [news][${ts()}]`, ...args);

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

// Normaliza URL de mídia removendo query strings de qualidade/tamanho.
// Reddit devolve a mesma imagem em qualidades diferentes via ?width=NNN.
// Removemos tudo depois do "?" para deduplicar versões da mesma imagem.
function normalizeMediaUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(String(url));
        u.search = '';
        return u.toString();
    } catch (_) {
        return String(url).split('?')[0].split('#')[0];
    }
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

        const media = extractMedia(body, link);
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

function extractMedia(body, link = '') {
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

    // Detecta domínio do post. Pode estar em:
    // 1) <category domain="v.redd.it">
    // 2) Conteúdo interno com domain=v.redd.it
    // 3) <link> apontando para v.redd.it diretamente
    // 4) Selftext mencionando "v.redd.it" ou "[link]" para v.redd.it
    let domain = '';
    const catDomain = body.match(/<category[^>]*domain\s*=\s*"([^"]+)"/i);
    if (catDomain) domain = catDomain[1];
    if (!domain) {
        const catInner = body.match(/<category[^>]*>([\s\S]*?)<\/category>/i);
        if (catInner) {
            const m2 = String(catInner[1]).match(/domain["']?\s*[:=]\s*["']?([a-z0-9.\-]+)/i);
            if (m2) domain = m2[1];
        }
    }
    if (!domain) {
        // Procura no conteúdo HTML por link v.redd.it
        const vReddMatch = (contentHtml || '').match(/https?:\/\/v\.redd\.it\/[^\s"'<>]+/i);
        if (vReddMatch) domain = 'v.redd.it';
    }
    if (!domain && link) {
        try {
            const u = new URL(link);
            if (/\.redd\.it$/i.test(u.hostname) && u.hostname !== 'www.reddit.com' && u.hostname !== 'reddit.com') {
                domain = u.hostname;
            }
        } catch (_) {}
    }

    // Se detectou v.redd.it, é post de vídeo SEMPRE — mesmo que tenha thumbnail.
    // O bot vai buscar a URL real do MP4 via JSON API depois.
    const isVideoPost = /v\.redd\.it/i.test(domain) ||
        (!directVideo && /v\.redd\.it|reddit_video/i.test(contentHtml || '')) ||
        (!!domain && !directImage && !directVideo && /video/i.test(link || ''));

    const isGifPost = /\.(gif)$/i.test(domain) || (!!directImage && /\.gif(\?|$|&)/i.test(directImage));

    return {
        thumbnail,
        image: directImage || thumbnail,
        video: directVideo,
        isVideoPost,
        isGifPost,
        domain: domain || null
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
const _subCooldownUntil = new Map();
const _subConsecutiveRateLimits = new Map();

function _bumpSubCooldown(sub) {
    const n = (_subConsecutiveRateLimits.get(sub) || 0) + 1;
    _subConsecutiveRateLimits.set(sub, n);
    const baseWait = 120;
    const waitMs = baseWait * Math.min(8, Math.pow(2, n - 1)) * 1000;
    const prev = _subCooldownUntil.get(sub) || 0;
    const subUntil = Date.now() + waitMs;
    if (subUntil > prev) _subCooldownUntil.set(sub, subUntil);
    _rateLimitedUntil = Math.max(_rateLimitedUntil, subUntil);
    return { waitMs, attempt: n };
}

function _clearSubCooldown(sub) {
    _subConsecutiveRateLimits.set(sub, 0);
    _subCooldownUntil.delete(sub);
}

// Quando o RSS não traz a URL direta do MP4 (post v.redd.it), busca via API JSON.
async function fetchVideoFromJson(postId, userAgent) {
    if (!postId) return null;
    try {
        const url = `https://www.reddit.com/comments/${encodeURIComponent(postId)}.json`;
        const res = await axios.get(url, {
            timeout: HTTP_TIMEOUT_MS,
            headers: buildHeaders(userAgent),
            responseType: 'text',
            validateStatus: () => true,
            transformResponse: [(data) => data]
        });
        if (res.status !== 200 || !res.data) {
            newsErr(`JSON API para ${postId} retornou status=${res.status}`);
            return null;
        }
        const data = JSON.parse(res.data);
        const post = Array.isArray(data) && data[0]?.data?.children?.[0]?.data;
        if (!post) {
            newsErr(`JSON API para ${postId}: estrutura inesperada.`);
            return null;
        }
        const v = post?.secure_media?.reddit_video || post?.media?.reddit_video;
        if (v && v.fallback_url) return String(v.fallback_url);
        newsErr(`JSON API para ${postId}: sem reddit_video.fallback_url (domain=${post.domain || '?'})`);
        return null;
    } catch (e) {
        newsErr(`JSON API para ${postId} falhou:`, e?.message || e);
        return null;
    }
}

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

        // Subreddit inexistente, banido, privado ou removido: o Reddit devolve
        // HTML 404 com body "page not found". NÃO é rate-limit, NÃO é erro
        // transitório. Marca cooldown longo para evitar spam de requests, mas
        // não toca no contador de rate-limit.
        const status = res.status;
        if (status === 404 || status === 403 || status === 410) {
            const prev = _subCooldownUntil.get(sub) || 0;
            const subUntil = Date.now() + 6 * 60 * 60 * 1000;
            if (subUntil > prev) _subCooldownUntil.set(sub, subUntil);
            newsErr(`r/${sub} feed respondeu status=${status} (subreddit inexistente/privado/banido) → cooldown 6h. Remova de newsSubreddits se quiser desativar.`);
            return { __rateLimited: true, items: [], __invalidSub: true };
        }

        if (res.status === 429 || res.status === 503) {
            const ra = parseInt(res.headers && res.headers['retry-after'], 10);
            const baseWait = (Number.isFinite(ra) && ra > 0 ? ra : 120);
            const n = (_subConsecutiveRateLimits.get(sub) || 0) + 1;
            _subConsecutiveRateLimits.set(sub, n);
            const waitMs = baseWait * Math.min(8, Math.pow(2, n - 1)) * 1000;
            const prev = _subCooldownUntil.get(sub) || 0;
            const subUntil = Date.now() + waitMs;
            if (subUntil > prev) _subCooldownUntil.set(sub, subUntil);
            _rateLimitedUntil = Math.max(_rateLimitedUntil, subUntil);
            newsErr(`r/${sub} feed respondeu status=${res.status} → aguardando ${Math.round(waitMs / 1000)}s (tentativa #${n})`);
            return { __rateLimited: true, items: [] };
        }
        if (res.status !== 200 || !res.data) {
            newsErr(`r/${sub} feed respondeu status=${res.status}`);
            return { __rateLimited: false, items: [] };
        }

        // Detecta HTML 200 falso (subreddit inexistente em /new/.rss).
        // O Reddit às vezes devolve página HTML com "page not found" + status 200.
        const bodyLower = String(res.data).slice(0, 500).toLowerCase();
        if (bodyLower.includes('page not found') || bodyLower.includes('<!doctype html')) {
            const prev = _subCooldownUntil.get(sub) || 0;
            const subUntil = Date.now() + 6 * 60 * 60 * 1000;
            if (subUntil > prev) _subCooldownUntil.set(sub, subUntil);
            newsErr(`r/${sub} feed retornou HTML (subreddit inválido/indisponível) → cooldown 6h. Remova de newsSubreddits.`);
            return { __rateLimited: true, items: [], __invalidSub: true };
        }

        _clearSubCooldown(sub);
        return { __rateLimited: false, items: parseRssItems(String(res.data)) };
    } catch (e) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes('429') || msg.includes('rate')) {
            const n = (_subConsecutiveRateLimits.get(sub) || 0) + 1;
            _subConsecutiveRateLimits.set(sub, n);
            const waitMs = 120 * Math.min(8, Math.pow(2, n - 1)) * 1000;
            const prev = _subCooldownUntil.get(sub) || 0;
            const subUntil = Date.now() + waitMs;
            if (subUntil > prev) _subCooldownUntil.set(sub, subUntil);
            _rateLimitedUntil = Math.max(_rateLimitedUntil, subUntil);
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

// Converte um buffer GIF em MP4 via ffmpeg para preservar animação no WhatsApp.
// WhatsApp só anima GIFs quando enviados como vídeo com gifPlayback=true.
// Limitamos tamanho/qualidade para evitar travamento.
async function convertGifToMp4(buffer) {
    if (!buffer || buffer.length === 0) return null;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const inPath = path.join(os.tmpdir(), `news_gif_${id}.gif`);
    const outPath = path.join(os.tmpdir(), `news_mp4_${id}.mp4`);
    try {
        fs.writeFileSync(inPath, buffer);
        await new Promise((resolve, reject) => {
            const ff = spawn('ffmpeg', [
                '-y',
                '-i', inPath,
                '-vf', "scale='min(720,iw)':-2:flags=lanczos",
                '-r', '15',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-crf', '23',
                '-preset', 'veryfast',
                '-movflags', '+faststart',
                '-an',
                outPath
            ], { stdio: ['ignore', 'ignore', 'ignore'] });
            ff.on('error', reject);
            ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
        });
        const mp4 = fs.readFileSync(outPath);
        return mp4.length > 0 ? mp4 : null;
    } catch (e) {
        newsErr(`conversão GIF→MP4 falhou:`, e?.message || e);
        return null;
    } finally {
        try { fs.unlinkSync(inPath); } catch (_) {}
        try { fs.unlinkSync(outPath); } catch (_) {}
    }
}

async function sendOne(sock, jid, post, sub, showMeta) {
    const caption = buildCaption(post, sub, showMeta);
    const cfg = readConfig();
    const media = post.media || {};
    newsLog(`r/${sub} post ${post.id}: domain=${media.domain || '?'} isVideo=${!!(post.isVideoPost || media.isVideoPost)} isGif=${!!media.isGifPost} hasVideo=${!!media.video} hasImage=${!!media.image}`);
    const maxRetries = Math.max(0, Number(cfg.newsMaxRetries) || 3);
    const retryBaseDelayMs = Math.max(1000, Number(cfg.newsRetryBaseDelayMs) || 15000);
    const retryOpts = {
        maxRetries,
        baseDelayMs: retryBaseDelayMs,
        onRetry: (n, wait) => console.warn(`📰 [news] rate-limit r/${sub} → ${jid} tentativa ${n}, aguardando ${wait}ms`)
    };

    await new Promise(resolve => setImmediate(resolve));
    if (Date.now() < _rateLimitedUntil) {
        newsLog(`pulando envio para ${jid} (rate-limit global ativo).`);
        return;
    }

    // Se é post de vídeo mas não temos URL direta, busca via JSON API.
    // (post.isVideoPost OU media.isVideoPost — `isVideoPost` é colocado dentro
    // de media pelo extractMedia.)
    const isVideoPostFlag = !!(post.isVideoPost || media.isVideoPost);
    if (isVideoPostFlag && post.id) {
        if (!media.video || !isVideoUrl(media.video)) {
            const vUrl = await fetchVideoFromJson(post.id, cfg.newsUserAgent);
            if (vUrl) {
                media.video = vUrl;
                newsLog(`r/${sub}: URL de vídeo obtida via JSON API.`);
            } else {
                newsErr(`r/${sub}: post ${post.id} marcado como vídeo mas JSON API não retornou URL.`);
            }
        }
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
            newsErr(`falha vídeo r/${sub}:`, e.message);
        }
    }

    if (media.image) {
        // Se é post de vídeo e o JSON não retornou URL, NÃO cai no fallback
        // de imagem (que enviaria thumbnail estática como "imagem" no WhatsApp).
        // Pula direto para enviar só o texto com link.
        if (isVideoPostFlag && !media.video) {
            newsErr(`r/${sub} post ${post.id}: vídeo sem URL acessível — pulando envio de mídia.`);
            return;
        }
        try {
            const dl = await downloadToBuffer(media.image, cfg.newsUserAgent);
            if (dl && dl.buffer && dl.buffer.length > 0) {
                const mimeLower = (dl.mime || '').toLowerCase();
                const urlIsGif = isGifUrl(media.image);
                const urlIsVideo = isVideoUrl(media.image);
                const bufferIsVideo = mimeLower.startsWith('video/');
                const bufferIsGif = mimeLower === 'image/gif' || urlIsGif;

                if (urlIsVideo || bufferIsVideo) {
                    const payload = { video: dl.buffer, mimetype: dl.mime || 'video/mp4' };
                    if (caption) payload.caption = caption;
                    return await sendMessageSafe(sock, jid, payload, retryOpts);
                } else if (urlIsGif || bufferIsGif) {
                    // WhatsApp só anima GIFs enviados como MP4 com gifPlayback=true.
                    // Converte o buffer via ffmpeg para preservar a animação.
                    const mp4 = await convertGifToMp4(dl.buffer);
                    if (mp4) {
                        const payload = { video: mp4, mimetype: 'video/mp4', gifPlayback: true };
                        if (caption) payload.caption = caption;
                        return await sendMessageSafe(sock, jid, payload, retryOpts);
                    }
                    // Fallback: envia como imagem estática se a conversão falhar
                    const payload = { image: dl.buffer, mimetype: 'image/gif' };
                    if (caption) payload.caption = caption;
                    return await sendMessageSafe(sock, jid, payload, retryOpts);
                } else {
                    const payload = { image: dl.buffer, mimetype: dl.mime || 'image/jpeg' };
                    if (caption) payload.caption = caption;
                    return await sendMessageSafe(sock, jid, payload, retryOpts);
                }
            }
        } catch (e) {
            newsErr(`falha imagem r/${sub}:`, e.message);
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
                newsLog(`fila pausada por rate-limit; limpando backlog (${sendQueue.length} itens).`);
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
                        newsErr(`rate-limit em ${jid}; cooldown 120s.`);
                        break;
                    } else {
                        newsErr(`erro ao enviar ${post.id} para ${jid}:`, e?.message || e);
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
        newsLog(`em cooldown (rate-limit) por mais ${wait}s — pulando poll.`);
        return;
    }

    const cfg = readConfig();
    const subs = dedupeSubreddits(cfg.newsSubreddits);
    if (subs.length === 0) return;

    const groups = listNewsGroups().filter(jid => isNewsEnabled(jid));
    if (groups.length === 0) {
        newsLog('nenhum grupo com feed ativado.');
        return;
    }

    const randomMode = !!cfg.newsRandomSub;
    const showMeta = !!cfg.newsShowMeta;
    const sendDelayMs = Math.max(0, Number(cfg.newsSendDelayMs) || 5000);
    const staggerMs = Math.max(0, Number(cfg.newsFetchStaggerMs) || 30000);
    const onePerCycle = !!cfg.newsOnePerCycle;

    const lastSeen = getNewsState(STATE_KEY, {}) || {};

    // Subreddits a consultar neste ciclo.
    // newsRandomSub = false → todos os configurados (padrão).
    // newsRandomSub = true  → sorteia 1 sub por ciclo.
    let subsToCheck = subs;
    if (randomMode && subs.length > 1) {
        subsToCheck = [subs[Math.floor(Math.random() * subs.length)]];
    }

    let firstSubOfCycle = true;
    let publishedThisCycle = false;

    for (const sub of subsToCheck) {
        if (onePerCycle && publishedThisCycle) {
            newsLog(`cycle: 1 post já publicado neste ciclo — demais subs ficam para o próximo poll.`);
            break;
        }

        // Cooldown por sub: pula este e tenta o próximo.
        const subCooldown = _subCooldownUntil.get(sub) || 0;
        if (Date.now() < subCooldown) {
            const wait = Math.round((subCooldown - Date.now()) / 1000);
            newsLog(`r/${sub}: em cooldown por mais ${wait}s — pulando.`);
            continue;
        }

        // Stagger entre subs: evita burst de requests que dispara 429 do Reddit.
        if (!firstSubOfCycle && staggerMs > 0) {
            newsLog(`aguardando ${Math.round(staggerMs / 1000)}s antes de r/${sub}...`);
            const steps = Math.ceil(staggerMs / 5000);
            for (let i = 0; i < steps; i++) {
                if (isShuttingDown) return;
                await sleep(Math.min(5000, staggerMs - i * 5000));
            }
        }
        firstSubOfCycle = false;

        let result = { __rateLimited: false, items: [] };
        try {
            result = await fetchSubredditFeed(sub, cfg.newsUserAgent);
        } catch (e) {
            newsErr(`falha ao buscar feed r/${sub}:`, e.message);
            continue;
        }
        if (result.__rateLimited) continue;
        const posts = result.items;
        if (!posts || posts.length === 0) continue;

        // SEMPRE pega o ÚLTIMO (primeiro do feed /new).
        const latest = posts[0];
        if (!latest || !latest.id) continue;

        // lastSeen[sub] agora guarda { id, imageUrl } do último publicado.
        // Dedupe por id E por URL de imagem (Reddit às vezes faz cross-post
        // com IDs diferentes mas mesma imagem — sem isso, duplicaria).
        const previous = lastSeen[sub] || null;
        const currentImage = normalizeMediaUrl((latest.media && (latest.media.image || latest.media.thumbnail)) || '');
        const previousImage = (previous && typeof previous === 'object') ? (previous.imageUrl || '') : '';
        const previousId = (previous && typeof previous === 'object') ? previous.id : (typeof previous === 'string' ? previous : null);

        const sameById = previousId === latest.id;
        const sameByImage = !!currentImage && currentImage === previousImage;

        if (sameById || sameByImage) {
            const reason = sameById ? `id ${latest.id}` : `imagem duplicada`;
            newsLog(`r/${sub}: sem post novo (${reason} já postado).`);
            continue;
        }

        // Persiste o estado **antes** de enviar. Assim, mesmo se o envio falhar
        // (rate-limit, queda do bot), o próximo poll não vai republicar.
        lastSeen[sub] = { id: latest.id, imageUrl: normalizeMediaUrl(currentImage), at: Date.now() };
        setNewsState(STATE_KEY, lastSeen);

        // Se é post de vídeo (v.redd.it) sem URL direta do MP4, busca via JSON API.
        if (latest.isVideoPost && !latest.media.video) {
            const vUrl = await fetchVideoFromJson(latest.id, cfg.newsUserAgent);
            if (vUrl) {
                latest.media.video = vUrl;
                newsLog(`r/${sub}: URL de vídeo obtida via JSON API.`);
            }
        }

        newsLog(`r/${sub}: novo último post ${latest.id} — publicando.`);
        publishedThisCycle = true;

        for (const jid of groups) {
            if (isShuttingDown) break;
            if (!isNewsEnabled(jid)) continue;
            if (Date.now() < _rateLimitedUntil) {
                newsLog(`envio pausado por rate-limit global.`);
                break;
            }

            try {
                await sendOne(sockRef, jid, latest, sub, showMeta);
            } catch (e) {
                const msg = String(e?.message || e || '').toLowerCase();
                if (msg.includes('rate') || msg.includes('overlimit') || msg.includes('429')) {
                    _rateLimitedUntil = Math.max(_rateLimitedUntil, Date.now() + 120 * 1000);
                    newsErr(`rate-limit em ${jid}; cooldown 120s.`);
                    break;
                } else {
                    newsErr(`erro ao enviar ${latest.id} para ${jid}:`, e?.message || e);
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
        pollOnce().catch(e => newsErr(`poll: ${e?.message || e}`));
    }, ms);
    if (pollTimer.unref) pollTimer.unref();
    setTimeout(() => {
        pollOnce().catch(e => newsErr(`initial poll: ${e?.message || e}`));
    }, 20 * 1000);
    newsLog(`polling ativado a cada ${Math.round(ms / 1000)}s (subs: ${(cfg.newsSubreddits || []).join(', ')})`);
}

function stop() {
    isShuttingDown = true;
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

module.exports = { attachSock, start, stop, pollOnce };
