const { describe, it, mock } = require('node:test');
const assert = require('node:assert');

// Testa funções puras extraídas manualmente (cópias simples sem dependências)
// para verificar o comportamento esperado sem carregar o módulo completo
// que depende de better-sqlite3, ffmpeg, etc.

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

function normalizeJid(jid) {
    if (!jid) return jid;
    const [rawUser, domain] = jid.split('@');
    const [user] = rawUser.split(':');
    return `${user}@${domain || 's.whatsapp.net'}`;
}

function isViewOnce(message) {
    if (!message) return false;
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension) return true;
    const media = m.imageMessage || m.videoMessage || m.audioMessage;
    return !!(media && (media.viewOnce === true || media.viewOnce === 1));
}

function getMediaMessage(message) {
    if (!message) return null;
    let m = message;
    for (let i = 0; i < 5; i++) {
        if (m.ephemeralMessage) m = m.ephemeralMessage.message;
        else if (m.viewOnceMessage) m = m.viewOnceMessage.message;
        else if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
        else if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
        else if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
        else break;
    }
    if (m.imageMessage || m.videoMessage || m.stickerMessage || m.audioMessage || m.documentMessage) return m;
    if (m.url && (m.mimetype || m.fileLength)) return m;
    return null;
}

function getMessageText(message) {
    if (!message) return '';
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    if (!m) return '';
    return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}

function _buildBackoffs(baseMs) {
    const base = Math.max(500, Number(baseMs) || 15000);
    return [base, Math.round(base * 2.5), Math.round(base * 5), Math.round(base * 10), Math.round(base * 20)];
}

function _isRateLimitError(err) {
    if (!err) return false;
    const data = err.data || err.output?.payload;
    if (data?.statusCode === 429) return true;
    const msg = String(err.message || err || '').toLowerCase();
    return msg.includes('rate-overlimit') || msg.includes('rate overlimit') || msg.includes('429');
}

describe('formatUptime', () => {
    it('deve formatar segundos zerados', () => {
        assert.strictEqual(formatUptime(0), '0s');
    });

    it('deve formatar apenas segundos', () => {
        assert.strictEqual(formatUptime(45), '45s');
    });

    it('deve formatar minutos e segundos', () => {
        assert.strictEqual(formatUptime(125), '2m 5s');
    });

    it('deve formatar horas, minutos e segundos', () => {
        assert.strictEqual(formatUptime(3661), '1h 1m 1s');
    });

    it('deve formatar dias, horas, minutos e segundos', () => {
        assert.strictEqual(formatUptime(90061), '1d 1h 1m 1s');
    });

    it('deve formatar valor exato de 1 hora', () => {
        assert.strictEqual(formatUptime(3600), '1h');
    });

    it('deve formatar valor exato de 1 dia', () => {
        assert.strictEqual(formatUptime(86400), '1d');
    });
});

describe('normalizeJid', () => {
    it('deve retornar null/undefined se jid for nullish', () => {
        assert.strictEqual(normalizeJid(null), null);
        assert.strictEqual(normalizeJid(undefined), undefined);
    });

    it('deve remover sufixo :number do jid', () => {
        assert.strictEqual(normalizeJid('5511999999999:5@s.whatsapp.net'), '5511999999999@s.whatsapp.net');
    });

    it('deve adicionar domínio padrão se não tiver', () => {
        assert.strictEqual(normalizeJid('5511999999999'), '5511999999999@s.whatsapp.net');
    });

    it('deve manter jid já normalizado', () => {
        assert.strictEqual(normalizeJid('5511999999999@s.whatsapp.net'), '5511999999999@s.whatsapp.net');
    });

    it('deve manter domínio @g.us', () => {
        assert.strictEqual(normalizeJid('5511999999999-123456@g.us'), '5511999999999-123456@g.us');
    });
});

describe('isViewOnce', () => {
    it('deve retornar false para mensagem vazia', () => {
        assert.strictEqual(isViewOnce(null), false);
        assert.strictEqual(isViewOnce(undefined), false);
    });

    it('deve retornar true para viewOnceMessage', () => {
        const msg = { viewOnceMessage: { message: { imageMessage: {} } } };
        assert.strictEqual(isViewOnce(msg), true);
    });

    it('deve retornar true para viewOnceMessageV2', () => {
        const msg = { viewOnceMessageV2: { message: { imageMessage: {} } } };
        assert.strictEqual(isViewOnce(msg), true);
    });

    it('deve retornar true para media com viewOnce=true', () => {
        const msg = { imageMessage: { viewOnce: true } };
        assert.strictEqual(isViewOnce(msg), true);
    });

    it('deve retornar true para media com viewOnce=1', () => {
        const msg = { imageMessage: { viewOnce: 1 } };
        assert.strictEqual(isViewOnce(msg), true);
    });

    it('deve retornar false para media normal', () => {
        const msg = { imageMessage: {} };
        assert.strictEqual(isViewOnce(msg), false);
    });

    it('deve retornar false para mensagem de texto', () => {
        const msg = { conversation: 'ola' };
        assert.strictEqual(isViewOnce(msg), false);
    });

    it('deve desencapsular ephemeralMessage', () => {
        const msg = { ephemeralMessage: { message: { imageMessage: { viewOnce: true } } } };
        assert.strictEqual(isViewOnce(msg), true);
    });
});

describe('getMediaMessage', () => {
    it('deve retornar null para mensagem vazia', () => {
        assert.strictEqual(getMediaMessage(null), null);
        assert.strictEqual(getMediaMessage(undefined), null);
    });

    it('deve retornar a mensagem se tiver imageMessage', () => {
        const msg = { imageMessage: { mimetype: 'image/jpeg' } };
        const result = getMediaMessage(msg);
        assert.notStrictEqual(result, null);
        assert.ok(result.imageMessage);
    });

    it('deve retornar a mensagem se tiver stickerMessage', () => {
        const msg = { stickerMessage: {} };
        assert.notStrictEqual(getMediaMessage(msg), null);
    });

    it('deve desencapsular viewOnceMessageV2', () => {
        const inner = { imageMessage: { mimetype: 'image/jpeg' } };
        const msg = { viewOnceMessageV2: { message: inner } };
        const result = getMediaMessage(msg);
        assert.notStrictEqual(result, null);
        assert.ok(result.imageMessage);
    });

    it('deve retornar null para mensagem de texto', () => {
        assert.strictEqual(getMediaMessage({ conversation: 'oi' }), null);
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
        const msg = { extendedTextMessage: { text: 'teste' } };
        assert.strictEqual(getMessageText(msg), 'teste');
    });

    it('deve extrair caption de imageMessage', () => {
        const msg = { imageMessage: { caption: 'foto legal' } };
        assert.strictEqual(getMessageText(msg), 'foto legal');
    });

    it('deve desencapsular viewOnceMessage', () => {
        const msg = { viewOnceMessage: { message: { conversation: 'secreta' } } };
        assert.strictEqual(getMessageText(msg), 'secreta');
    });

    it('deve desencapsular ephemeralMessage', () => {
        const msg = { ephemeralMessage: { message: { conversation: 'efêmera' } } };
        assert.strictEqual(getMessageText(msg), 'efêmera');
    });

    it('deve retornar string vazia se não encontrar texto', () => {
        assert.strictEqual(getMessageText({ reactionMessage: { text: '❤️' } }), '');
    });
});

describe('_buildBackoffs', () => {
    it('deve gerar backoffs com base em 15000ms', () => {
        const backoffs = _buildBackoffs(15000);
        assert.strictEqual(backoffs.length, 5);
        assert.strictEqual(backoffs[0], 15000);
        assert.strictEqual(backoffs[1], 37500);
        assert.strictEqual(backoffs[2], 75000);
        assert.strictEqual(backoffs[3], 150000);
        assert.strictEqual(backoffs[4], 300000);
    });

    it('deve usar mínimo de 500ms para valores muito baixos', () => {
        const backoffs = _buildBackoffs(100);
        assert.ok(backoffs[0] >= 500);
    });

    it('deve usar 15000ms como fallback para NaN', () => {
        const backoffs = _buildBackoffs(NaN);
        assert.strictEqual(backoffs[0], 15000);
    });
});

describe('_isRateLimitError', () => {
    it('deve retornar false para null/undefined', () => {
        assert.strictEqual(_isRateLimitError(null), false);
        assert.strictEqual(_isRateLimitError(undefined), false);
    });

    it('deve detectar statusCode 429', () => {
        const err = { data: { statusCode: 429 } };
        assert.strictEqual(_isRateLimitError(err), true);
    });

    it('deve detectar statusCode 429 em output.payload', () => {
        const err = { output: { payload: { statusCode: 429 } } };
        assert.strictEqual(_isRateLimitError(err), true);
    });

    it('deve detectar mensagem rate-overlimit', () => {
        const err = new Error('rate-overlimit');
        assert.strictEqual(_isRateLimitError(err), true);
    });

    it('deve detectar mensagem 429', () => {
        const err = new Error('HTTP Error 429');
        assert.strictEqual(_isRateLimitError(err), true);
    });

    it('deve retornar false para erro comum', () => {
        const err = new Error('connection refused');
        assert.strictEqual(_isRateLimitError(err), false);
    });
});
