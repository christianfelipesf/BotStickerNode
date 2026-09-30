const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const cmd = require('../../src/commands/aidono.js');
const ownerAgent = require('../../src/services/ownerAgent');

function makeSock(inbox) {
    return {
        sendMessage: async (to, content) => { inbox.push(String(content?.text || '')); return {}; }
    };
}
const stubUtils = {
    canConfigureBot: () => ({ ok: true }),
    react: async () => 1,
    reactStatus: async () => 2,
    groupMetadataCached: async () => null
};
const base = {
    from: 'g1@g.us', isGroup: true, sender: 'dono@s.whatsapp.net',
    config: { prefix: '!' }, utils: stubUtils, model: {},
    lastBotResponse: 0, GLOBAL_COOLDOWN: 0, abortSignal: undefined, log: () => {}
};
function makeMsg(text) {
    return { key: { remoteJid: 'g1@g.us', fromMe: false }, pushName: 'Dono', message: { extendedTextMessage: { text, contextInfo: {} } } };
}

describe('!aidono — confirmação do investigar', () => {
    beforeEach(() => {
        // limpa pendências entre testes (mesma chave from::sender)
        delete require.cache[require.resolve('../../src/commands/aidono.js')];
    });

    it('investigar pede confirmação e NÃO roda o loop', async () => {
        const fresh = require('../../src/commands/aidono.js');
        const inbox = [];
        let called = false;
        const orig = ownerAgent.runInvestigativeLoop;
        ownerAgent.runInvestigativeLoop = async () => { called = true; return { answer: 'x', partial: false, usage: { rounds: 1 } }; };
        try {
            await fresh.execute(makeSock(inbox), makeMsg('!aidono investigar briga no grupo'), { ...base, fullArgsText: 'investigar briga no grupo' });
        } finally {
            ownerAgent.runInvestigativeLoop = orig;
        }
        assert.strictEqual(called, false, 'loop não pode rodar sem confirmação');
        assert.ok(inbox.some((t) => /confirmar investigação/i.test(t)), 'deve pedir confirmação');
        assert.ok(inbox.some((t) => /aidono sim/i.test(t)), 'deve explicar como confirmar');
    });

    it('!aidono sim executa a investigação pendente', async () => {
        const fresh = require('../../src/commands/aidono.js');
        const inbox = [];
        const orig = ownerAgent.runInvestigativeLoop;
        let gotQuestion = null;
        ownerAgent.runInvestigativeLoop = async ({ question }) => { gotQuestion = question; return { answer: 'apurei Y', partial: false, usage: { rounds: 2 } }; };
        try {
            await fresh.execute(makeSock(inbox), makeMsg('!aidono investigar briga'), { ...base, fullArgsText: 'investigar briga' });
            assert.strictEqual(gotQuestion, null, 'nada ainda');
            await fresh.execute(makeSock(inbox), makeMsg('!aidono sim'), { ...base, fullArgsText: 'sim' });
        } finally {
            ownerAgent.runInvestigativeLoop = orig;
        }
        assert.strictEqual(gotQuestion, 'briga');
        assert.ok(inbox.some((t) => t.includes('apurei Y')), 'deve entregar a resposta');
    });

    it('!aidono não cancela sem rodar nada', async () => {
        const fresh = require('../../src/commands/aidono.js');
        const inbox = [];
        let called = false;
        const orig = ownerAgent.runInvestigativeLoop;
        ownerAgent.runInvestigativeLoop = async () => { called = true; return { answer: 'x', partial: false, usage: {} }; };
        try {
            await fresh.execute(makeSock(inbox), makeMsg('!aidono investigar z'), { ...base, fullArgsText: 'investigar z' });
            await fresh.execute(makeSock(inbox), makeMsg('!aidono não'), { ...base, fullArgsText: 'não' });
        } finally {
            ownerAgent.runInvestigativeLoop = orig;
        }
        assert.strictEqual(called, false);
        assert.ok(inbox.some((t) => /cancelada/i.test(t)));
    });

    it('sim sem pendência não faz nada de investigar', async () => {
        const fresh = require('../../src/commands/aidono.js');
        const inbox = [];
        // sender diferente = sem pendência
        await fresh.execute(makeSock(inbox), makeMsg('!aidono sim'), { ...base, sender: 'outro@s.whatsapp.net', fullArgsText: 'sim' });
        assert.ok(!inbox.some((t) => /investigação/i.test(t)));
    });
});
