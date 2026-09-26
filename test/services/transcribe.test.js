const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    parseTranscribeArgs,
    resolveAudioTarget,
    buildLocalArgs,
    parseLocalResult,
    pickProviders,
    transcribeViaOpenAICompat,
    FALLBACK_MODEL,
    DEFAULT_MAX_SECONDS,
    STT_URL,
    PROVIDER_DEFAULT_MODELS
} = require('../../src/services/transcribe');

// getMediaMessage fake: espelha src/database/media.js para audio/image
function fakeGetMediaMessage(message) {
    if (!message) return null;
    if (message.audioMessage || message.videoMessage || message.imageMessage) return message;
    return null;
}

const GROUP = '123@g.us';
const DM = '5511999999999@s.whatsapp.net';

describe('transcribe: constantes', () => {
    it('usa modelo whisper e endpoint STT do OpenRouter', () => {
        assert.equal(FALLBACK_MODEL, 'openai/whisper-1');
        assert.equal(STT_URL, 'https://openrouter.ai/api/v1/audio/transcriptions');
        assert.ok(DEFAULT_MAX_SECONDS > 0);
    });
});

describe('transcribe: parseTranscribeArgs', () => {
    it('default pt sem args', () => {
        assert.deepEqual(parseTranscribeArgs([]), { language: 'pt' });
        assert.deepEqual(parseTranscribeArgs(undefined), { language: 'pt' });
    });
    it('aceita idioma ISO-639-1 como primeiro arg', () => {
        assert.deepEqual(parseTranscribeArgs(['en']), { language: 'en' });
        assert.deepEqual(parseTranscribeArgs(['ES']), { language: 'es' });
    });
    it('nao confunde texto com idioma', () => {
        assert.deepEqual(parseTranscribeArgs(['ola', 'mundo']), { language: 'pt' });
        assert.deepEqual(parseTranscribeArgs(['portugues']), { language: 'pt' });
    });
});

describe('transcribe: resolveAudioTarget', () => {
    it('audio citado em grupo monta key com participant', () => {
        const m = {
            message: {
                extendedTextMessage: {
                    text: '!transcrever',
                    contextInfo: {
                        stanzaId: 'ABC123',
                        participant: '5511888888888@s.whatsapp.net',
                        quotedMessage: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 12 } }
                    }
                }
            }
        };
        const r = resolveAudioTarget({ user: { id: '5511777777777@s.whatsapp.net' } }, GROUP, m, fakeGetMediaMessage);
        assert.ok(r.targetMsg);
        assert.ok(r.targetMsg.message.audioMessage);
        assert.equal(r.targetMsg.key.remoteJid, GROUP);
        assert.equal(r.targetMsg.key.id, 'ABC123');
        assert.equal(r.targetMsg.key.participant, '5511888888888@s.whatsapp.net');
        assert.equal(r.targetMsg.key.fromMe, false);
    });

    it('mensagem marcada sem audio retorna quotedNonAudio', () => {
        const m = {
            message: {
                extendedTextMessage: {
                    contextInfo: { stanzaId: 'X', quotedMessage: { imageMessage: {} } }
                }
            }
        };
        const r = resolveAudioTarget(null, GROUP, m, fakeGetMediaMessage);
        assert.equal(r.targetMsg, null);
        assert.equal(r.quotedNonAudio, true);
    });

    it('audio direto na mensagem funciona', () => {
        const m = { message: { audioMessage: { mimetype: 'audio/ogg', seconds: 5 } } };
        const r = resolveAudioTarget(null, DM, m, fakeGetMediaMessage);
        assert.equal(r.targetMsg, m);
        assert.ok(r.mediaMessage.audioMessage);
    });

    it('video direto tambem e aceito (extrai faixa de audio)', () => {
        const m = { message: { videoMessage: { mimetype: 'video/mp4', seconds: 30 } } };
        const r = resolveAudioTarget(null, DM, m, fakeGetMediaMessage);
        assert.equal(r.targetMsg, m);
        assert.ok(r.mediaMessage.videoMessage);
    });

    it('sem midia retorna nulo', () => {
        const m = { message: { conversation: '!transcrever' } };
        const r = resolveAudioTarget(null, DM, m, fakeGetMediaMessage);
        assert.equal(r.targetMsg, null);
        assert.equal(r.mediaMessage, null);
        assert.equal(r.quotedNonAudio || false, false);
    });

    it('em DM a key citada omite participant', () => {
        const m = {
            message: {
                extendedTextMessage: {
                    contextInfo: {
                        stanzaId: 'DM1',
                        quotedMessage: { audioMessage: { seconds: 3 } }
                    }
                }
            }
        };
        const r = resolveAudioTarget({ user: { id: '5511777777777@s.whatsapp.net' } }, DM, m, fakeGetMediaMessage);
        assert.ok(r.targetMsg);
        assert.ok(!('participant' in r.targetMsg.key));
        assert.equal(r.targetMsg.key.remoteJid, DM);
    });
});

describe('transcribe: pickProviders', () => {
    it('auto prefere groq > openai > openrouter > local', () => {
        const list = pickProviders({ groqApiKey: 'g', openaiApiKey: 'o', openrouterApiKey: 'r' });
        assert.deepEqual(list.map((c) => c.provider), ['groq', 'openai', 'openrouter', 'local']);
        assert.equal(list[0].model, PROVIDER_DEFAULT_MODELS.groq);
    });
    it('auto sem chaves cai direto no local', () => {
        const list = pickProviders({});
        assert.deepEqual(list.map((c) => c.provider), ['local']);
    });
    it('transcribeModel sobrescreve o modelo cloud', () => {
        const list = pickProviders({ groqApiKey: 'g', transcribeModel: 'whisper-large-v3' });
        assert.equal(list[0].model, 'whisper-large-v3');
    });
    it('provedor forcado sem chave falha com orientacao', () => {
        assert.throws(() => pickProviders({ transcribeProvider: 'groq' }), /GROQ_API_KEY/);
    });
    it('provedor invalido falha', () => {
        assert.throws(() => pickProviders({ transcribeProvider: 'xpto' }), /transcribeProvider inválido/);
    });
});

describe('transcribe: local helpers', () => {
    it('buildLocalArgs monta comando python', () => {
        const { cmd, args } = buildLocalArgs('/tmp/a.mp3', { model: 'base', language: 'pt' });
        assert.ok(['python', 'python3'].includes(cmd));
        assert.ok(args[0].endsWith('transcribe_local.py'));
        assert.deepEqual(args.slice(1), ['/tmp/a.mp3', '--model', 'base', '--language', 'pt']);
    });
    it('parseLocalResult extrai texto', () => {
        const out = '{"text": "ola mundo", "language": "pt", "duration": 1.2}\n';
        assert.equal(parseLocalResult(out, 0), 'ola mundo');
    });
    it('parseLocalResult marca faster-whisper ausente', () => {
        const out = '{"error": "faster-whisper nao instalado (pip install faster-whisper)"}';
        assert.throws(() => parseLocalResult(out, 3), (e) => e.code === 'LOCAL_MISSING');
    });
    it('parseLocalResult rejeita saida invalida', () => {
        assert.throws(() => parseLocalResult('lixo', 1), /saída inválida/);
    });
});

describe('transcribe: cloud compativel (mock)', () => {
    it('retorna texto e envia multipart com file+model+language', async () => {
        let seen = null;
        const fakePost = async (url, form, opts) => {
            seen = { url, opts };
            assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
            assert.ok(String(opts.headers.Authorization).startsWith('Bearer '));
            assert.equal(form.get('model'), 'whisper-large-v3-turbo');
            assert.equal(form.get('language'), 'pt');
            const f = form.get('file');
            assert.equal(f.name, 'audio.mp3');
            assert.ok(f.size > 0);
            return { data: { text: '  teste mockado  ' } };
        };
        const text = await transcribeViaOpenAICompat(Buffer.from('MP3FAKE'), {
            url: 'https://api.groq.com/openai/v1/audio/transcriptions',
            apiKey: 'k',
            model: 'whisper-large-v3-turbo',
            language: 'pt',
            httpPost: fakePost,
            providerName: 'Groq'
        });
        assert.equal(text, 'teste mockado');
        assert.ok(seen);
    });
    it('401 vira mensagem de chave invalida', async () => {
        const fakePost = async () => {
            const e = new Error('Request failed');
            e.response = { status: 401, data: { error: { message: 'Invalid API Key' } } };
            throw e;
        };
        await assert.rejects(
            transcribeViaOpenAICompat(Buffer.from('x'), {
                url: 'https://x', apiKey: 'k', model: 'm', httpPost: fakePost, providerName: 'Groq'
            }),
            /Chave Groq inválida/
        );
    });
    it('402 vira NO_BALANCE (dispara fallback)', async () => {
        const fakePost = async () => {
            const e = new Error('Request failed');
            e.response = { status: 402, data: { error: { message: 'This request requires at least $0.50 in balance for audio' } } };
            throw e;
        };
        await assert.rejects(
            transcribeViaOpenAICompat(Buffer.from('x'), {
                url: 'https://x', apiKey: 'k', model: 'm', httpPost: fakePost, providerName: 'Groq'
            }),
            (e) => e.code === 'NO_BALANCE'
        );
    });
});

describe('transcribe: comando registrado', () => {    it('transcrever.js existe e exporta nome/aliases/categoria', () => {
        const fs = require('fs');
        const path = require('path');
        const file = path.join(__dirname, '..', '..', 'src', 'commands', 'transcrever.js');
        assert.ok(fs.existsSync(file), 'src/commands/transcrever.js deve existir');
        const cmd = require('../../src/commands/transcrever');
        assert.equal(cmd.name, 'transcrever');
        assert.equal(cmd.category, 'mídia');
        assert.ok(cmd.aliases.includes('transcribe'));
        assert.equal(typeof cmd.execute, 'function');
    });
});
