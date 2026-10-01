# reddit-api — parte Reddit do BotStickerNode como API

> **Bot Gravity, Por christian Felipe (98) 989138217**

Extraído de `src/services/news.js` (RSS `/new/.rss`, JSON API, embed+HLS, `preview.redd.it` → `i.redd.it`, probe/parse de subreddits).

## Rodar

```bash
npm install
cp .env.example .env   # opcional
npm start
# http://localhost:3000
```

Com Docker:

```bash
docker build -t reddit-api .
docker run -p 3000:3000 reddit-api
```

## Endpoints

| Método | Rota | Exemplo |
|---|---|---|
| GET | `/health` | |
| GET | `/api/subreddit/:sub?limit=10&resolveVideo=0` | `/api/subreddit/pics?limit=5` |
| GET | `/api/feed?subs=pics,memes&limit=5` | multi-sub (máx 10) |
| GET | `/api/post/:id?sub=pics` | `/api/post/abc1234?sub=pics` |
| GET | `/api/video?sub=pics&id=abc1234` | resolve MP4 via JSON, fallback HLS do embed |
| GET | `/api/probe/:sub` | testa se o sub existe antes de assinar |
| POST | `/api/parse` `{ "text": "pics, r/gatos https://reddit.com/r/memes" }` | normaliza/valida lista |
| GET | `/api/image-url?url=...` | `preview.redd.it` → `i.redd.it` full-res |

Auth opcional: defina `API_KEY` no `.env` e envie header `x-api-key`.

## Origem no bot

- `src/services/news.js` → `lib/reddit.js` (funções puras, sem WhatsApp/DB)
- `src/commands/subreddit.js` (add/del/list + probe) → `GET /api/probe`, `POST /api/parse`
- `src/commands/news.js` (ativar/desativar feed) → polling fica a cargo de quem consome `/api/subreddit`

## Aviso

Respeite os limites do Reddit (429 = rate-limit). Uso educacional.
