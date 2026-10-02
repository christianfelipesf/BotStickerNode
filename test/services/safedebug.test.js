const { describe, it } = require('node:test');
const assert = require('node:assert');

const safe = require('../../src/services/safeDebug');

describe('safeDebug — chaves sensíveis', () => {
    it('detecta chaves de API/cookie/token/senha', () => {
        for (const k of ['cobaltApiKey', 'instagramCookies', 'OPENROUTER_API_KEY', 'telegramBotToken', 'authKey', 'clientSecret', 'dbPassword', 'senha']) {
            assert.strictEqual(safe.isSensitiveKey(k), true, k);
        }
    });

    it('não dá falso-positivo em chaves normais', () => {
        for (const k of ['botName', 'prefix', 'aiModel', 'stickerPack', 'newsSubreddits', 'dashboardUrl', 'subOwners', 'guardioes']) {
            assert.strictEqual(safe.isSensitiveKey(k), false, k);
        }
    });

    it('maskSecret nunca revela o valor', () => {
        const m = safe.maskSecret('sk-or-v1-abcdef123456');
        assert.ok(!m.includes('abcdef'), 'vazou segredo!');
        assert.ok(m.includes('••••'));
        assert.strictEqual(safe.maskSecret(''), '_(vazio)_');
        assert.ok(safe.maskSecret(['a', 'b']).includes('2'));
    });
});

describe('safeDebug — sanitizeUserText', () => {
    it('troca a pasta do projeto por ponto', () => {
        const cwd = process.cwd();
        const out = safe.sanitizeUserText(`falhou em ${cwd}/temp/x.txt, veja`);
        assert.ok(!out.includes(cwd), 'vazou cwd!');
        assert.ok(out.includes('.'));
    });

    it('mascara caminhos absolutos restantes e pares chave=valor', () => {
        const out = safe.sanitizeUserText(`ENOENT 'C:\\Users\\X\\cookies.txt' e cobaltApiKey=abc123 ok`);
        assert.ok(!out.includes('C:\\Users'), 'vazou path!');
        assert.ok(!out.includes('abc123'), 'vazou chave!');
        assert.ok(out.includes('[dir]'));
        assert.ok(out.includes('••••••••'));
    });

    it('texto normal passa intacto', () => {
        assert.strictEqual(safe.sanitizeUserText('Falha ao baixar áudio, tente de novo'), 'Falha ao baixar áudio, tente de novo');
        assert.strictEqual(safe.sanitizeUserText(''), '');
    });
});
