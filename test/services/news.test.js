const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isola o banco: news.js -> database/utils abre o SQLite no require.
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'news-test-')), 'bot.db');
process.env.BOT_DB_PATH = tmpDb;

let news;
before(() => {
    news = require('../../src/services/news');
});

// Amostra no formato real do /new/.rss do Reddit (Atom). O <content> vem
// entity-encoded, então `href="..."` literal só existe no <link> do post.
const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
<title>pics: new</title>
<entry>
<author><name>/u/testuser</name><uri>https://www.reddit.com/user/testuser</uri></author>
<category term="pics" label="r/pics" domain="i.redd.it"/>
<content type="html">&lt;table&gt; &lt;tr&gt;&lt;td&gt; &lt;a href=&quot;https://www.reddit.com/r/pics/comments/abc1234/foto_legal/&quot;&gt; [link] &lt;/a&gt; &lt;/td&gt;&lt;td&gt; &lt;img src=&quot;https://preview.redd.it/foto.jpg?width=640&amp;format=pjpg&amp;auto=webp&quot; /&gt; submitted by &lt;a href=&quot;https://www.reddit.com/user/testuser&quot;&gt; /u/testuser &lt;/a&gt; &lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</content>
<id>t3_abc1234</id>
<link href="https://www.reddit.com/r/pics/comments/abc1234/foto_legal/"/>
<updated>2026-09-26T10:00:00+00:00</updated>
<published>2026-09-26T10:00:00+00:00</published>
<title>Foto legal</title>
</entry>
<entry>
<author><name>/u/outro</name><uri>https://www.reddit.com/user/outro</uri></author>
<category term="pics" label="r/pics" domain="self.pics"/>
<content type="html">&lt;p&gt;Texto do post com &lt;a href=&quot;https://example.com/x&quot;&gt;link externo&lt;/a&gt;&lt;/p&gt; submitted by /u/outro [link] [comments]</content>
<id>t3_zzz9999</id>
<link href="https://www.reddit.com/r/pics/comments/zzz9999/desabafo/"/>
<updated>2026-09-26T09:00:00+00:00</updated>
<published>2026-09-26T09:00:00+00:00</published>
<title>Desabafo</title>
</entry>
</feed>`;

describe('news service', () => {
    it('exporta helpers puros para teste', () => {
        for (const fn of ['pollOnce', 'start', 'stop', 'parseRssItems', 'buildCaption', 'normalizeSubreddit', 'dedupeSubreddits', 'normalizeMediaUrl', 'parseIntervalMs', 'resolvePollMs', 'coerceMime', 'extractHlsPlaylist']) {
            assert.strictEqual(typeof news[fn], 'function', fn);
        }
    });

    it('parseRssItems extrai id/permalink do <link>, não do conteúdo', () => {
        const items = news.parseRssItems(SAMPLE_RSS);
        assert.strictEqual(items.length, 2);
        // Link-post: id vem da URL do permalink mesmo com [link] no conteúdo
        assert.strictEqual(items[0].id, 'abc1234');
        assert.strictEqual(items[0].permalink, 'https://www.reddit.com/r/pics/comments/abc1234/foto_legal/');
        assert.strictEqual(items[0].title, 'Foto legal');
        // Self-post com link externo no texto: não confunde o id
        assert.strictEqual(items[1].id, 'zzz9999');
        assert.strictEqual(items[1].permalink, 'https://www.reddit.com/r/pics/comments/zzz9999/desabafo/');
    });

    it('parseRssItems extrai mídia da thumbnail', () => {
        const items = news.parseRssItems(SAMPLE_RSS);
        assert.ok(items[0].media.image.includes('preview.redd.it/foto.jpg'));
    });

    it('normalizeMediaUrl remove query string (dedup de ?width=)', () => {
        const a = news.normalizeMediaUrl('https://preview.redd.it/foto.jpg?width=640&format=pjpg&auto=webp');
        const b = news.normalizeMediaUrl('https://preview.redd.it/foto.jpg?width=1080&format=png&auto=webp');
        assert.strictEqual(a, b);
        assert.ok(!a.includes('?'));
    });

    it('dedupeSubreddits normaliza r/, caixa e repetidos', () => {
        assert.deepStrictEqual(
            news.dedupeSubreddits(['r/pics', 'PICS', '/pics/', 'ShitpostBR', 'shitpostbr']),
            ['pics', 'shitpostbr']
        );
    });

    it('buildCaption inclui permalink só com showMeta', () => {
        const post = { title: 'T', selftext: 'texto', permalink: 'https://x/y' };
        const sem = news.buildCaption(post, 'pics', false);
        const com = news.buildCaption(post, 'pics', true);
        assert.ok(sem.includes('T') && sem.includes('texto'));
        assert.ok(!sem.includes('https://x/y'));
        assert.ok(com.includes('https://x/y'));
    });

    it('parseIntervalMs entende número (min), m, s, h, ms', () => {
        assert.strictEqual(news.parseIntervalMs(30), 30 * 60 * 1000);
        assert.strictEqual(news.parseIntervalMs('45m'), 45 * 60 * 1000);
        assert.strictEqual(news.parseIntervalMs('60s'), 60 * 1000);
        assert.strictEqual(news.parseIntervalMs('1h'), 3600 * 1000);
        assert.strictEqual(news.parseIntervalMs('60000ms'), 60000);
    });

    it('resolvePollMs honra o legado newsPollIntervalMs', () => {
        assert.strictEqual(news.resolvePollMs({ newsPollIntervalMinutes: 30 }), 30 * 60 * 1000);
        assert.strictEqual(news.resolvePollMs({ newsPollIntervalMs: 120000 }), 120000);
        assert.strictEqual(news.resolvePollMs({}), 15 * 60 * 1000);
        // piso de 60s
        assert.strictEqual(news.resolvePollMs({ newsPollIntervalMs: 1000 }), 60 * 1000);
    });

    it('coerceMime preserva família correta e corrige octet-stream', () => {
        assert.strictEqual(news.coerceMime('video/mp4', 'video', 'video/mp4'), 'video/mp4');
        assert.strictEqual(news.coerceMime('application/octet-stream', 'video', 'video/mp4'), 'video/mp4');
        assert.strictEqual(news.coerceMime('', 'image', 'image/jpeg'), 'image/jpeg');
        assert.strictEqual(news.coerceMime('image/png; charset=utf-8', 'image', 'image/jpeg'), 'image/png');
    });

    it('extractHlsPlaylist acha a master do embed e ignora resto', () => {
        const html = '<html><script>\\"https://v.redd.it/ol1v5v0wkvrh1/HLSPlaylist.m3u8?f=sd\\",\\"https://v.redd.it/ol1v5v0wkvrh1/CMAF_96.mp4\\"</script></html>';
        assert.strictEqual(news.extractHlsPlaylist(html), 'https://v.redd.it/ol1v5v0wkvrh1/HLSPlaylist.m3u8?f=sd');
        assert.strictEqual(news.extractHlsPlaylist('<html>sem video</html>'), null);
        assert.strictEqual(news.extractHlsPlaylist(''), null);
    });
});
