const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isViewOnce, getMediaMessage, getContextInfo, getMessageText } = require('../../src/database/media');

describe('isViewOnce', () => {
    it('deve retornar false para mensagem vazia', () => {
        assert.strictEqual(isViewOnce(null), false);
        assert.strictEqual(isViewOnce(undefined), false);
    });

    it('deve retornar true para viewOnceMessage', () => {
        assert.strictEqual(isViewOnce({ viewOnceMessage: { message: { imageMessage: {} } } }), true);
    });

    it('deve retornar true para viewOnceMessageV2', () => {
        assert.strictEqual(isViewOnce({ viewOnceMessageV2: { message: { imageMessage: {} } } }), true);
    });

    it('deve retornar true para media com viewOnce=true', () => {
        assert.strictEqual(isViewOnce({ imageMessage: { viewOnce: true } }), true);
        assert.strictEqual(isViewOnce({ imageMessage: { viewOnce: 1 } }), true);
    });

    it('deve retornar false para media normal', () => {
        assert.strictEqual(isViewOnce({ imageMessage: {} }), false);
    });

    it('deve desencapsular ephemeralMessage', () => {
        assert.strictEqual(isViewOnce({ ephemeralMessage: { message: { imageMessage: { viewOnce: true } } } }), true);
    });
});

describe('getMediaMessage', () => {
    it('deve retornar null para mensagem vazia', () => {
        assert.strictEqual(getMediaMessage(null), null);
    });

    it('deve retornar a mensagem se tiver imageMessage', () => {
        const result = getMediaMessage({ imageMessage: { mimetype: 'image/jpeg' } });
        assert.notStrictEqual(result, null);
        assert.ok(result.imageMessage);
    });

    it('deve retornar null para mensagem de texto', () => {
        assert.strictEqual(getMediaMessage({ conversation: 'oi' }), null);
    });
});

describe('getContextInfo', () => {
    it('deve retornar null para mensagem vazia', () => {
        assert.strictEqual(getContextInfo(null), null);
    });

    it('deve extrair contextInfo de imageMessage', () => {
        const ctx = { stanzaId: 'abc', participant: '5511@s.whatsapp.net' };
        const msg = { imageMessage: { contextInfo: ctx } };
        assert.deepStrictEqual(getContextInfo(msg), ctx);
    });
});

describe('getMessageText', () => {
    it('deve retornar string vazia para null/undefined', () => {
        assert.strictEqual(getMessageText(null), '');
        assert.strictEqual(getMessageText(undefined), '');
    });

    it('deve extrair conversation', () => {
        assert.strictEqual(getMessageText({ conversation: 'ola' }), 'ola');
    });

    it('deve extrair extendedTextMessage', () => {
        assert.strictEqual(getMessageText({ extendedTextMessage: { text: 'teste' } }), 'teste');
    });

    it('deve extrair caption de imageMessage', () => {
        assert.strictEqual(getMessageText({ imageMessage: { caption: 'foto legal' } }), 'foto legal');
    });

    it('deve desencapsular viewOnceMessage', () => {
        assert.strictEqual(getMessageText({ viewOnceMessage: { message: { conversation: 'secreta' } } }), 'secreta');
    });
});
