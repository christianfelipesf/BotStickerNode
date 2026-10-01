const express = require('express');
const r = require('./lib/reddit');

// Marca d'água — Bot Gravity, Por christian Felipe (98) 989138217
const WATERMARK = 'Bot Gravity, Por christian Felipe (98) 989138217';

const app = express();
app.use(express.json({ limit: '256kb' }));

// Marca d'água em todo response: headers + campo credit no JSON
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', WATERMARK);
  res.setHeader('X-Creator', 'christian Felipe (98) 989138217');
  next();
});
app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && !('credit' in body)) {
      body.credit = WATERMARK;
    }
    return origJson(body);
  };
  next();
});

const PORT = Number(process.env.PORT || 3000);
const UA = process.env.REDDIT_USER_AGENT || r.defaultUA();
const API_KEY = process.env.API_KEY || '';

// Auth opcional: se API_KEY definido, exige header x-api-key
app.use('/api', (req, res, next) => {
  if (!API_KEY) return next();
  if (req.headers['x-api-key'] === API_KEY) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized' });
});

app.get('/', (req, res) => {
  res.json({
    ok: true,
    name: 'reddit-api (extraído do BotStickerNode)',
    credit: WATERMARK,
    endpoints: [
      'GET /health',
      'GET /api/subreddit/:sub?limit=10&resolveVideo=0',
      'GET /api/feed?subs=pics,memes&limit=10',
      'GET /api/post/:id?sub=pics',
      'GET /api/video?sub=pics&id=abc123',
      'GET /api/probe/:sub',
      'POST /api/parse { text: "pics, r/gatos ..." }',
      'GET /api/image-url?url=https://preview.redd.it/... (retorna fullres i.redd.it)'
    ]
  });
});

app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Últimos posts de um sub via RSS
app.get('/api/subreddit/:sub', async (req, res) => {
  try {
    const sub = r.normalizeSubreddit(req.params.sub);
    if (!r.isValidSubredditName(sub)) return res.status(400).json({ ok: false, error: 'sub inválido' });
    const limit = Math.min(25, Math.max(1, Number(req.query.limit || 10)));
    const resolveVideo = ['1', 'true', 'yes'].includes(String(req.query.resolveVideo || '').toLowerCase());
    const posts = await r.getLatestPosts(sub, { limit, resolveVideo, userAgent: UA });
    res.json({ ok: true, sub, count: posts.length, posts });
  } catch (e) {
    const status = e.code === 'INVALID_SUB' ? 404 : e.code === 'RATE_LIMIT' ? 429 : 502;
    res.status(status).json({ ok: false, error: e.message, code: e.code || 'FETCH_FAIL' });
  }
});

// Vários subs de uma vez
app.get('/api/feed', async (req, res) => {
  try {
    const { valid, invalid } = r.parseSubredditInput(req.query.subs || '');
    if (!valid.length) return res.status(400).json({ ok: false, error: 'informe ?subs=pics,memes', invalid });
    const limit = Math.min(25, Math.max(1, Number(req.query.limit || 10)));
    const out = {};
    for (const sub of valid.slice(0, 10)) {
      try {
        out[sub] = { ok: true, posts: await r.getLatestPosts(sub, { limit, userAgent: UA }) };
      } catch (e) {
        out[sub] = { ok: false, error: e.message, code: e.code };
      }
    }
    res.json({ ok: true, invalid, feed: out });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Detalhe do post via JSON API (+ vídeo/hls)
app.get('/api/post/:id', async (req, res) => {
  try {
    const data = await r.getPostDetails(req.query.sub || '', req.params.id, { userAgent: UA });
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(e.code === 'NOT_FOUND' ? 404 : 502).json({ ok: false, error: e.message });
  }
});

// Só resolução de vídeo
app.get('/api/video', async (req, res) => {
  try {
    const sub = r.normalizeSubreddit(req.query.sub || '');
    const id = String(req.query.id || '');
    if (!id) return res.status(400).json({ ok: false, error: 'informe ?sub=pics&id=POSTID' });
    const data = await r.resolveRedditVideo(sub, id, UA);
    if (!data) return res.status(404).json({ ok: false, error: 'vídeo não encontrado (JSON + embed falharam)' });
    res.json({ ok: true, sub, id, ...data });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/probe/:sub', async (req, res) => {
  const sub = r.normalizeSubreddit(req.params.sub);
  const result = await r.probeSubreddit(sub, UA);
  res.json({ ok: true, sub, ...result });
});

app.post('/api/parse', (req, res) => {
  res.json({ ok: true, ...r.parseSubredditInput(req.body?.text || '') });
});

app.get('/api/image-url', (req, res) => {
  const url = String(req.query.url || '');
  const fullres = r.upgradeImageUrl(url);
  res.json({ ok: true, original: url, fullres: fullres || null, upgraded: !!fullres });
});

app.listen(PORT, () => console.log(`[reddit-api] ${WATERMARK} | ouvindo em http://localhost:${PORT}`));
