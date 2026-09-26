const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { enforceAntiflood, clearAntifloodState, getAntifloodStats } = require('../src/services/antiflood');

const G = 'test-flood@g.us';
const U = '5511999999999@s.whatsapp.net';

function mockSock(calls) {
    return {
        sendMessage: async (to, msg) => { calls.push({ to, msg }); return true; }
    };
}

function msg(id, tsSec) {
    return {
        key: { remoteJid: G, id: `FLOOD${id}`, participant: U, fromMe: false },
        messageTimestamp: tsSec
    };
}

describe('antiflood — janela por timestamp da mensagem', () => {
    beforeEach(() => { clearAntifloodState(G); });

    it('apaga a 6ª msg de rajada (limite padrão 5/8s) e registra hit', async () => {
        const calls = [];
        const sock = mockSock(calls);
        const base = Math.floor(Date.now() / 1000);
        let ret = null;
        for (let i = 0; i < 6; i++) {
            ret = await enforceAntiflood(sock, msg(i, base - 5 + i), G, U, false, true);
        }
        assert.equal(ret, 'antiflood');
        const dels = calls.filter(c => c.msg && c.msg.delete);
        assert.ok(dels.length >= 1, 'deveria tentar apagar a msg do flood');
        assert.equal(dels[0].msg.delete.id, 'FLOOD5');
        const st = getAntifloodStats(G);
        assert.equal(st.hits, 1);
    });

    it('não pune msgs espaçadas fora da janela', async () => {
        const calls = [];
        const sock = mockSock(calls);
        const base = Math.floor(Date.now() / 1000);
        let ret = null;
        // 7 msgs a cada 3s ao longo de 18s — nunca >5 em 8s
        for (let i = 0; i < 7; i++) {
            ret = await enforceAntiflood(sock, msg(i, base - 18 + i * 3), G, U, false, true);
            assert.equal(ret, null, `msg ${i} não deveria ser flood`);
        }
        assert.equal(getAntifloodStats(G).hits, 0);
    });

    it('isenta admin por padrão e age quando bot não é admin nunca', async () => {
        const calls = [];
        const sock = mockSock(calls);
        const base = Math.floor(Date.now() / 1000);
        for (let i = 0; i < 8; i++) {
            const r = await enforceAntiflood(sock, msg(i, base - 5 + i), G, U, true, true);
            assert.equal(r, null, 'admin isento por padrão');
        }
        for (let i = 0; i < 8; i++) {
            const r = await enforceAntiflood(sock, msg('b' + i, base - 5 + i), G, U, false, false);
            assert.equal(r, null, 'sem bot-admin não age');
        }
        assert.equal(calls.length, 0);
    });
});
