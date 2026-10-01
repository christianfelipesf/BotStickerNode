// Bot Gravity, Por christian Felipe (98) 989138217
// reddit.js — lógica extraída de src/services/news.js do BotStickerNode
// Standalone: sem dependência de WhatsApp / banco do bot.
// Cobre: RSS /new/.rss, JSON API, embed+HLS, preview->fullres, probe, parse.
const axios = require('axios');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const HTTP_TIMEOUT_MS = 20 * 1000;
const MEDIA_TIMEOUT_MS = 60 * 1000;
const MEDIA_MAX_BYTES = 64 * 1024 * 1024;

function defaultUA() {
  return process.env.REDDIT_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
}

function buildHeaders(userAgent) {
  return {
    'User-Agent': String(userAgent || defaultUA()),
    'Accept': 'application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8'
  };
}

function normalizeSubreddit(name) {
  return String(name || '').trim().replace(/^r\//i, '').replace(/^\//, '').replace(/\/$/, '').toLowerCase();
}

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

function extractSubredditName(raw) {
  let s = String(raw || '').trim().replace(/^\/+/, '');
  if (!s) return '';
  const urlM = s.match(/(?:https?:\/\/)?(?:www\.|old\.|new\.|m\.)?reddit\.com\/r\/([A-Za-z0-9_]+)/i);
  if (urlM) return urlM[1].toLowerCase();
  if (/^u\//i.test(s)) return '';
  return normalizeSubreddit(s);
}

function isValidSubredditName(name) {
  return /^[a-z0-9_]{2,32}$/.test(String(name || ''));
}

function parseSubredditInput(text) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  const tokens = String(text || '').split(/[,\s|;]+/).map(t => t.trim()).filter(Boolean);
  for (const tok of tokens) {
    const name = extractSubredditName(tok);
    if (!name || !isValidSubredditName(name)) {
      if (!seen.has(tok.toLowerCase())) invalid.push(tok);
      seen.add(tok.toLowerCase());
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    valid.push(name);
  }
  return { valid, invalid };
}

async function probeSubreddit(sub, userAgent, httpGet) {
  const get = httpGet || axios.get;
  sub = normalizeSubreddit(sub);
  if (!isValidSubredditName(sub)) return { ok: false, reason: 'invalido' };
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss`;
  let res;
  try {
    res = await get(url, {
      timeout: HTTP_TIMEOUT_MS,
      headers: buildHeaders(userAgent),
      responseType: 'text',
      validateStatus: () => true,
      transformResponse: [(data) => data]
    });
  } catch (e) {
    return { ok: false, reason: 'rede' };
  }
  const status = res?.status;
  if (status === 404 || status === 403 || status === 410) return { ok: false, reason: 'inexistente' };
  if (status === 429 || status === 503) return { ok: false, reason: 'rate-limit' };
  if (status !== 200 || !res?.data) return { ok: false, reason: 'rede' };
  const head = String(res.data).slice(0, 500).toLowerCase();
  if (head.includes('page not found') || head.includes('<!doctype html')) {
    return { ok: false, reason: 'inexistente' };
  }
  return { ok: true };
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

  const isVideoPost = /v\.redd\.it/i.test(domain) ||
    (!directVideo && /v\.redd\.it|reddit_video/i.test(contentHtml || '')) ||
    (!!domain && !directImage && !directVideo && /video/i.test(link || ''));

  const isGifPost = /\.(gif)$/i.test(domain) || (!!directImage && /\.gif(\?|$|&)/i.test(directImage));

  return { thumbnail, image: directImage || thumbnail, video: directVideo, isVideoPost, isGifPost, domain: domain || null };
}

function extractSelftext(body) {
  let raw = null;
  const htmlTyped = body.match(/<content[^>]*type\s*=\s*"html"[^>]*>([\s\S]*?)<\/content>/i);
  if (htmlTyped) raw = htmlTyped[1];
  if (!raw) {
    const generic = body.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
    if (generic) raw = generic[1];
  }
  if (!raw) {
    const summary = body.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    if (summary) raw = summary[1];
  }
  if (!raw) {
    const desc = body.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    if (desc) raw = desc[1];
  }
  if (!raw) return '';
  raw = String(raw).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const decoded = decodeEntities(raw);
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

async function fetchSubredditFeed(sub, userAgent) {
  sub = normalizeSubreddit(sub);
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new/.rss`;
  const res = await axios.get(url, {
    timeout: HTTP_TIMEOUT_MS,
    headers: buildHeaders(userAgent),
    responseType: 'text',
    validateStatus: () => true,
    transformResponse: [(data) => data]
  });
  const status = res.status;
  if (status === 404 || status === 403 || status === 410) {
    const e = new Error(`r/${sub} inexistente/privado/banido (status ${status})`);
    e.code = 'INVALID_SUB';
    e.status = status;
    throw e;
  }
  if (res.status === 429 || res.status === 503) {
    const e = new Error(`Reddit rate-limit (status ${status})`);
    e.code = 'RATE_LIMIT';
    e.status = status;
    throw e;
  }
  if (res.status !== 200 || !res.data) {
    const e = new Error(`Feed respondeu status=${res.status}`);
    e.code = 'FETCH_FAIL';
    e.status = res.status;
    throw e;
  }
  const bodyLower = String(res.data).slice(0, 500).toLowerCase();
  if (bodyLower.includes('page not found') || bodyLower.includes('<!doctype html')) {
    const e = new Error(`r/${sub} retornou HTML (sub inválido)`);
    e.code = 'INVALID_SUB';
    throw e;
  }
  return parseRssItems(String(res.data));
}

const JSON_UAS = [
  null, // usa defaultUA()
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
];
const JSON_ENDPOINTS = (postId) => [
  `https://old.reddit.com/comments/${encodeURIComponent(postId)}.json`,
  `https://www.reddit.com/comments/${encodeURIComponent(postId)}.json`,
  `https://i.reddit.com/comments/${encodeURIComponent(postId)}.json`
];

async function fetchJsonPost(postId, userAgent) {
  for (const url of JSON_ENDPOINTS(postId)) {
    for (const uaTpl of JSON_UAS) {
      const ua = uaTpl || String(userAgent || defaultUA());
      try {
        const res = await axios.get(url, {
          timeout: HTTP_TIMEOUT_MS,
          headers: {
            'User-Agent': ua,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          responseType: 'text',
          validateStatus: () => true,
          transformResponse: [(data) => data]
        });
        if (res.status !== 200 || !res.data) continue;
        let data;
        try { data = JSON.parse(res.data); } catch (_) { continue; }
        const post = Array.isArray(data) && data[0]?.data?.children?.[0]?.data;
        if (post) return post;
      } catch (_) {}
    }
  }
  return null;
}

async function fetchVideoFromJson(postId, userAgent) {
  const post = await fetchJsonPost(postId, userAgent);
  if (!post) return null;
  const v = post?.secure_media?.reddit_video || post?.media?.reddit_video;
  if (v && v.fallback_url) return String(v.fallback_url);
  if (v && v.dash_url) return String(v.dash_url);
  return null;
}

async function fetchSelftextFromJson(postId, userAgent) {
  const post = await fetchJsonPost(postId, userAgent);
  if (!post) return null;
  const txt = String(post.selftext || '').trim();
  if (!txt) return null;
  return txt.length > 2000 ? txt.slice(0, 1997) + '...' : txt;
}

function extractHlsPlaylist(html) {
  if (!html) return null;
  const m = String(html).match(/https?:\/\/v\.redd\.it\/[A-Za-z0-9]+\/HLSPlaylist\.m3u8(?:\?[^\s"'<>\\]*)?/);
  return m ? m[0] : null;
}

async function fetchHlsPlaylistUrl(sub, postId, userAgent) {
  if (!sub || !postId) return null;
  try {
    const url = `https://embed.reddit.com/r/${encodeURIComponent(sub)}/comments/${encodeURIComponent(postId)}/?embed=true`;
    const res = await axios.get(url, {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'User-Agent': buildHeaders(userAgent)['User-Agent'],
        'Accept': 'text/html,*/*',
        'Referer': 'https://www.reddit.com/'
      },
      responseType: 'text',
      validateStatus: () => true,
      transformResponse: [(data) => data]
    });
    if (res.status !== 200 || !res.data) return null;
    return extractHlsPlaylist(String(res.data));
  } catch (_) {
    return null;
  }
}

function isVideoUrl(url) {
  if (!url) return false;
  const u = String(url);
  if (/\/[^./?#]+\.(mp4|webm)(\?|$|#|&)/i.test(u)) return true;
  if (/\.(mp4|webm)(\?|$|&)/i.test(u)) return true;
  return false;
}
function isGifUrl(url) {
  if (!url) return false;
  const u = String(url);
  if (/\/[^./?#]+\.gif(\?|$|#|&)/i.test(u)) return true;
  if (/\.gif(\?|$|&)/i.test(u)) return true;
  return false;
}

async function resolveRedditVideo(sub, postId, userAgent) {
  if (!postId) return null;
  const vUrl = await fetchVideoFromJson(postId, userAgent);
  if (vUrl && isVideoUrl(vUrl)) return { url: vUrl, source: 'json' };
  const hls = await fetchHlsPlaylistUrl(sub, postId, userAgent);
  if (hls) return { hls, source: 'embed-hls', hint: 'baixe com ffmpeg: ffmpeg -i "<hls>" -c copy out.mp4' };
  return null;
}

function upgradeImageUrl(url) {
  const m = String(url || '').match(/^https?:\/\/preview\.redd\.it\/([A-Za-z0-9]+\.(?:jpe?g|png|webp|gif))/i);
  if (!m) return '';
  return `https://i.redd.it/${m[1]}`;
}

async function downloadToBuffer(mediaUrl, userAgent) {
  const res = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    timeout: MEDIA_TIMEOUT_MS,
    headers: { 'User-Agent': buildHeaders(userAgent)['User-Agent'], 'Accept': '*/*' },
    maxRedirects: 5,
    validateStatus: () => true,
    maxContentLength: MEDIA_MAX_BYTES,
    maxBodyLength: MEDIA_MAX_BYTES
  });
  if (res.status < 200 || res.status >= 300 || !res.data) {
    const e = new Error(`download status=${res.status}`);
    e.status = res.status;
    throw e;
  }
  const mime = (res.headers && res.headers['content-type']) || '';
  return { buffer: Buffer.from(res.data), mime: String(mime).split(';')[0].trim() };
}

async function downloadImageBest(url, userAgent) {
  const hiRes = upgradeImageUrl(url);
  if (hiRes && hiRes !== url) {
    try {
      const dl = await downloadToBuffer(hiRes, userAgent);
      if (dl && dl.buffer && dl.buffer.length > 0) return { ...dl, upgraded: true, url: hiRes };
    } catch (_) {}
  }
  const dl = await downloadToBuffer(url, userAgent);
  return { ...dl, upgraded: false, url };
}

function coerceMime(mime, family, fallback) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith(family + '/')) return String(mime).split(';')[0].trim();
  return fallback;
}

function hasMediaContent(post) {
  const m = (post && post.media) || {};
  return !!(m.image || m.video || m.thumbnail);
}

// Alto nível: últimos posts com vídeo resolvido + selftext fallback
async function getLatestPosts(sub, { limit = 10, resolveVideo = false, userAgent } = {}) {
  const ua = userAgent || defaultUA();
  const items = await fetchSubredditFeed(sub, ua);
  const sliced = items.slice(0, Math.max(1, Math.min(25, Number(limit) || 10)));
  if (!resolveVideo) return sliced;
  for (const p of sliced) {
    const isV = p?.media?.isVideoPost;
    if (isV && (!p.media.video || !isVideoUrl(p.media.video))) {
      try {
        const r = await resolveRedditVideo(normalizeSubreddit(sub), p.id, ua);
        if (r?.url) p.media.videoResolved = r.url;
        if (r?.hls) p.media.hls = r.hls;
      } catch (_) {}
    }
    if (!hasMediaContent(p) && !p.selftext) {
      try {
        const t = await fetchSelftextFromJson(p.id, ua);
        if (t) p.selftext = t;
      } catch (_) {}
    }
    // fullres hint sem baixar
    if (p?.media?.image) {
      const hi = upgradeImageUrl(p.media.image);
      if (hi) p.media.imageFullres = hi;
    }
  }
  return sliced;
}

async function getPostDetails(sub, postId, { userAgent } = {}) {
  const ua = userAgent || defaultUA();
  const post = await fetchJsonPost(postId, ua);
  if (!post) {
    const e = new Error('post não encontrado via JSON API');
    e.code = 'NOT_FOUND';
    throw e;
  }
  const v = post?.secure_media?.reddit_video || post?.media?.reddit_video;
  let video = v?.fallback_url ? String(v.fallback_url) : null;
  let hls = null;
  if (!video && sub) hls = await fetchHlsPlaylistUrl(normalizeSubreddit(sub), postId, ua);
  return {
    id: postId,
    sub: normalizeSubreddit(sub || post.subreddit || ''),
    title: post.title || '',
    author: post.author || '',
    selftext: post.selftext || '',
    url: post.url || '',
    permalink: `https://www.reddit.com${post.permalink || `/comments/${postId}/`}`,
    score: post.score ?? null,
    numComments: post.num_comments ?? null,
    createdUtc: post.created_utc ?? null,
    over18: !!post.over_18,
    isVideo: !!post.is_video,
    video,
    hls,
    preview: post.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&') || null
  };
}

module.exports = {
  defaultUA,
  normalizeSubreddit,
  normalizeMediaUrl,
  dedupeSubreddits,
  extractSubredditName,
  isValidSubredditName,
  parseSubredditInput,
  probeSubreddit,
  parseRssItems,
  fetchSubredditFeed,
  fetchVideoFromJson,
  fetchSelftextFromJson,
  extractHlsPlaylist,
  fetchHlsPlaylistUrl,
  resolveRedditVideo,
  upgradeImageUrl,
  downloadToBuffer,
  downloadImageBest,
  coerceMime,
  isVideoUrl,
  isGifUrl,
  hasMediaContent,
  getLatestPosts,
  getPostDetails
};
