const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isola o banco: news.js -> database/utils abre o SQLite no require.
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'subreddit-test-')), 'bot.db');
process.env.BOT_DB_PATH = tmpDb;

let news;
before(() => {
    news = require('../../src/services/news');
});

describe('subreddit helpers', () => {
    it('exporta os novos helpers', () => {
        for (const fn of ['extractSubredditName', 'isValidSubredditName', 'parseSubredditInput', 'probeSubreddit']) {
            assert.strictEqual(typeof news[fn], 'function', fn);
        }
    });

    it('extractSubredditName aceita vários formatos', () => {
        assert.strictEqual(news.extractSubredditName('pics'), 'pics');
        assert.strictEqual(news.extractSubredditName('r/pics'), 'pics');
        assert.strictEqual(news.extractSubredditName('R/PICS'), 'pics');
        assert.strictEqual(news.extractSubredditName('/r/pics/'), 'pics');
        assert.strictEqual(news.extractSubredditName('https://www.reddit.com/r/pics'), 'pics');
        assert.strictEqual(news.extractSubredditName('https://www.reddit.com/r/pics/new/.rss'), 'pics');
        assert.strictEqual(news.extractSubredditName('reddit.com/r/ShitpostBR/'), 'shitpostbr');
        assert.strictEqual(news.extractSubredditName('old.reddit.com/r/gatos'), 'gatos');
        // u/nome é usuário, não sub
        assert.strictEqual(news.extractSubredditName('u/alguem'), '');
        assert.strictEqual(news.extractSubredditName(''), '');
    });

    it('isValidSubredditName valida o formato', () => {
        assert.strictEqual(news.isValidSubredditName('pics'), true);
        assert.strictEqual(news.isValidSubredditName('a'), false);
        assert.strictEqual(news.isValidSubredditName('x'.repeat(33)), false);
        assert.strictEqual(news.isValidSubredditName('com espaco'), false);
        assert.strictEqual(news.isValidSubredditName('com-traco'), false);
    });

    it('parseSubredditInput quebra lista mista e dedup', () => {
        const { valid, invalid } = news.parseSubredditInput('pics, r/gatos https://www.reddit.com/r/memes\npics; r/gatos | memes');
        assert.deepStrictEqual(valid, ['pics', 'gatos', 'memes']);
        assert.deepStrictEqual(invalid, []);
    });

    it('parseSubredditInput separa inválidos', () => {
        const { valid, invalid } = news.parseSubredditInput('pics, a, u/fulano, com-traco');
        assert.deepStrictEqual(valid, ['pics']);
        assert.strictEqual(invalid.length, 3);
    });

    it('probeSubreddit ok quando RSS 200 válido', async () => {
        const fakeGet = async () => ({ status: 200, data: '<?xml version="1.0"?><feed><entry></entry></feed>' });
        const r = await news.probeSubreddit('pics', 'ua-test', fakeGet);
        assert.deepStrictEqual(r, { ok: true });
    });

    it('probeSubreddit inexistente (404/403/410 e HTML falso)', async () => {
        for (const status of [404, 403, 410]) {
            const r = await news.probeSubreddit('naoexiste123', 'ua', async () => ({ status, data: 'page not found' }));
            assert.strictEqual(r.ok, false);
            assert.strictEqual(r.reason, 'inexistente');
        }
        const html = await news.probeSubreddit('x', 'ua', async () => ({ status: 200, data: '<!DOCTYPE html><html>page not found</html>' }));
        assert.deepStrictEqual(html, { ok: false, reason: 'inexistente' });
    });

    it('probeSubreddit rate-limit e erro de rede', async () => {
        const rl = await news.probeSubreddit('pics', 'ua', async () => ({ status: 429, data: '' }));
        assert.deepStrictEqual(rl, { ok: false, reason: 'rate-limit' });
        const net = await news.probeSubreddit('pics', 'ua', async () => { throw new Error('socket hang up'); });
        assert.deepStrictEqual(net, { ok: false, reason: 'rede' });
    });
});
