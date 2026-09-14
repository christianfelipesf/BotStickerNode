const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    parseTikWmMediaUrls,
    parseCobaltMediaUrls,
    getCobaltInstance,
} = require('../../src/services/downloaderCore');

describe('fallback A: TikWM parser', () => {
    it('prefere play no modo SD', () => {
        const urls = parseTikWmMediaUrls({ code: 0, data: {
            play: 'https://t.t/play.mp4', hdplay: 'https://t.t/hd.mp4', wmplay: 'https://t.t/wm.mp4'
        } }, false);
        assert.deepStrictEqual(urls, ['https://t.t/play.mp4']);
    });
    it('prefere hdplay no modo HD', () => {
        const urls = parseTikWmMediaUrls({ code: 0, data: {
            play: 'https://t.t/play.mp4', hdplay: 'https://t.t/hd.mp4', wmplay: 'https://t.t/wm.mp4'
        } }, true);
        assert.deepStrictEqual(urls, ['https://t.t/hd.mp4']);
    });
    it('retorna slideshow de imagens quando houver', () => {
        const urls = parseTikWmMediaUrls({ data: { images: ['https://t.t/1.jpg', 'https://t.t/2.jpg'] } }, true);
        assert.deepStrictEqual(urls, ['https://t.t/1.jpg', 'https://t.t/2.jpg']);
    });
    it('retorna [] em resposta inválida', () => {
        assert.deepStrictEqual(parseTikWmMediaUrls(null), []);
        assert.deepStrictEqual(parseTikWmMediaUrls({ code: -1 }), []);
    });
});

describe('fallback A: Cobalt parser', () => {
    it('tunnel/redirect vira URL única', () => {
        assert.deepStrictEqual(
            parseCobaltMediaUrls({ status: 'tunnel', url: 'https://cobalt/x.mp4' }),
            ['https://cobalt/x.mp4']
        );
        assert.deepStrictEqual(
            parseCobaltMediaUrls({ status: 'redirect', url: 'https://cobalt/y.mp4' }),
            ['https://cobalt/y.mp4']
        );
    });
    it('picker vira lista de URLs', () => {
        const urls = parseCobaltMediaUrls({ status: 'picker', picker: [
            { type: 'video', url: 'https://cobalt/a.mp4' },
            { type: 'photo', url: 'https://cobalt/b.jpg' },
            { type: 'video' },
        ] });
        assert.deepStrictEqual(urls, ['https://cobalt/a.mp4', 'https://cobalt/b.jpg']);
    });
    it('error retorna []', () => {
        assert.deepStrictEqual(parseCobaltMediaUrls({ status: 'error', error: { code: 'x' } }), []);
        assert.deepStrictEqual(parseCobaltMediaUrls(null), []);
    });
});

describe('fallback A: Cobalt desligado por padrão', () => {
    it('sem config nem env retorna null', () => {
        delete process.env.COBALT_API_URL;
        assert.strictEqual(getCobaltInstance(), null);
    });
});
