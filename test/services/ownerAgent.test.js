const { describe, it } = require('node:test');
const assert = require('node:assert');

const agent = require('../../src/services/ownerAgent');

const stubUtils = {
    findPeopleByName: (q) => String(q).toLowerCase().includes('carlos')
        ? [{ senderJid: '111@s.whatsapp.net', name: 'Carlos' }] : [],
    getMessagesBySender: () => [{ text: 'bla bla', name: 'Carlos', timestamp: 1700000000000 }],
    getMessagesByGroup: () => [{ text: 'oi', name: 'Ana', timestamp: 1700000000000 }],
    listDashboardGroupInfos: () => [{ jid: 'g1@g.us', subject: 'Amigos' }],
    getGroupData: () => ({ warnings: { '111@s.whatsapp.net': 1 } }),
    getDashboardGroupInfo: () => null,
    getTopMember: () => 'Ana',
    getRecentLogs: () => [],
    groupMetadataCached: async () => ({ subject: 'Atual', participants: [] })
};
const ctx = { sock: {}, from: 'g1@g.us', utils: stubUtils };

function fakeModel(script) {
    let i = 0;
    const calls = [];
    const model = {
        calls,
        chatWithTools: async (messages, tools) => {
            calls.push({ nMsgs: messages.length, nTools: tools.length });
            const step = script[Math.min(i++, script.length - 1)];
            return step;
        }
    };
    return model;
}

describe('ownerAgent', () => {
    it('exporta tools e constantes', () => {
        assert.strictEqual(agent.OWNER_TOOLS.length, 6);
        assert.strictEqual(agent.MAX_ROUNDS, 4);
        assert.ok(agent.OWNER_TOOLS.every((t) => t.type === 'function' && t.function?.name && t.function?.parameters));
    });

    it('executeTool buscar_mensagens_pessoa resolve nome e formata', async () => {
        const out = await agent.executeTool('buscar_mensagens_pessoa', { pessoa: 'Carlos' }, ctx);
        assert.ok(out.includes('Carlos'));
        assert.ok(out.includes('bla bla'));
    });

    it('executeTool pessoa desconhecida orienta usar número', async () => {
        const out = await agent.executeTool('buscar_mensagens_pessoa', { pessoa: 'Zé Ninguém' }, ctx);
        assert.ok(out.includes('não encontrada'));
    });

    it('executeTool ver_advs usa warnings', async () => {
        const out = await agent.executeTool('ver_advs', { pessoa: 'Carlos' }, ctx);
        assert.ok(out.includes('1/3'));
    });

    it('executeTool ferramenta desconhecida não quebra', async () => {
        const out = await agent.executeTool('fazer_cafe', {}, ctx);
        assert.ok(out.includes('desconhecida'));
    });

    it('runInvestigativeLoop: tool -> resposta final', async () => {
        const model = fakeModel([
            { text: '', toolCalls: [{ id: 'c1', function: { name: 'ver_advs', arguments: '{"pessoa":"Carlos"}' } }], finish: 'tool_calls' },
            { text: 'Carlos tem 1/3.', toolCalls: [], finish: 'stop' }
        ]);
        const r = await agent.runInvestigativeLoop({ model, sock: {}, question: 'advs do Carlos?', from: 'g1@g.us', isGroup: true, utils: stubUtils });
        assert.strictEqual(r.partial, false);
        assert.ok(r.answer.includes('1/3'));
        assert.strictEqual(r.rounds, 2);
        assert.strictEqual(model.calls[0].nTools, 6);
    });

    it('runInvestigativeLoop respeita o teto e devolve parcial', async () => {
        const model = fakeModel([
            { text: '', toolCalls: [{ id: 'c1', function: { name: 'listar_grupos', arguments: '{}' } }], finish: 'tool_calls' }
        ]);
        const r = await agent.runInvestigativeLoop({ model, sock: {}, question: 'investiga tudo', from: null, isGroup: false, utils: stubUtils });
        assert.strictEqual(r.rounds, agent.MAX_ROUNDS);
        assert.strictEqual(r.partial, true);
        assert.ok(r.answer.includes('Amigos'));
    });
});
