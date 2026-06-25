const { describe, it } = require('node:test');
const assert = require('node:assert');
const { createMuteHelpers } = require('../../src/database/mute');

function makeMockDb() {
    const store = new Map();
    return {
        getGroupState: (jid) => store.get(jid) || null,
        upsertGroupState: (jid, muted, warnings, antilink, activity) => {
            const cur = store.get(jid) || { warnings: '{}', antilink: 0, activity: '{}' };
            store.set(jid, {
                muted: muted ?? cur.muted,
                warnings: warnings ?? cur.warnings,
                antilink: antilink ?? cur.antilink,
                activity: activity ?? cur.activity,
                jid
            });
        },
        _store: store
    };
}

describe('createMuteHelpers', () => {
    it('deve criar API completa', () => {
        const db = makeMockDb();
        const api = createMuteHelpers({ getGroupState: db.getGroupState, upsertGroupState: db.upsertGroupState });
        assert.strictEqual(typeof api.isMuted, 'function');
        assert.strictEqual(typeof api.addMuted, 'function');
        assert.strictEqual(typeof api.removeMuted, 'function');
        assert.strictEqual(typeof api.listMuted, 'function');
        assert.strictEqual(typeof api.clearMuted, 'function');
        assert.strictEqual(typeof api.cleanupMuted, 'function');
        assert.strictEqual(typeof api.MUTE_TTL_MS, 'number');
    });

    it('deve adicionar e verificar mute', () => {
        const db = makeMockDb();
        const api = createMuteHelpers({ getGroupState: db.getGroupState, upsertGroupState: db.upsertGroupState });
        api.addMuted('group@g.us', '5511@s.whatsapp.net');
        assert.strictEqual(api.isMuted('group@g.us', '5511@s.whatsapp.net'), true);
        assert.strictEqual(api.isMuted('group@g.us', '5599@s.whatsapp.net'), false);
    });

    it('não deve adicionar mute duplicado', () => {
        const db = makeMockDb();
        const api = createMuteHelpers({ getGroupState: db.getGroupState, upsertGroupState: db.upsertGroupState });
        assert.strictEqual(api.addMuted('g@g.us', '55@s.whatsapp.net'), true);
        assert.strictEqual(api.addMuted('g@g.us', '55@s.whatsapp.net'), false);
    });

    it('deve remover mute', () => {
        const db = makeMockDb();
        const api = createMuteHelpers({ getGroupState: db.getGroupState, upsertGroupState: db.upsertGroupState });
        api.addMuted('g@g.us', '55@s.whatsapp.net');
        assert.strictEqual(api.removeMuted('g@g.us', '55@s.whatsapp.net'), true);
        assert.strictEqual(api.isMuted('g@g.us', '55@s.whatsapp.net'), false);
    });

    it('deve listar mutes', () => {
        const db = makeMockDb();
        const api = createMuteHelpers({ getGroupState: db.getGroupState, upsertGroupState: db.upsertGroupState });
        api.addMuted('g@g.us', '55@s.whatsapp.net');
        api.addMuted('g@g.us', '56@s.whatsapp.net');
        const list = api.listMuted('g@g.us');
        assert.strictEqual(list.length, 2);
        assert.ok(list.includes('55@s.whatsapp.net'));
        assert.ok(list.includes('56@s.whatsapp.net'));
    });

    it('deve limpar mutes', () => {
        const db = makeMockDb();
        const api = createMuteHelpers({ getGroupState: db.getGroupState, upsertGroupState: db.upsertGroupState });
        api.addMuted('g@g.us', '55@s.whatsapp.net');
        api.clearMuted('g@g.us');
        assert.strictEqual(api.listMuted('g@g.us').length, 0);
    });

    it('deve retornar false para jid inválido', () => {
        const db = makeMockDb();
        const api = createMuteHelpers({ getGroupState: db.getGroupState, upsertGroupState: db.upsertGroupState });
        assert.strictEqual(api.isMuted(null, '55@s.whatsapp.net'), false);
        assert.strictEqual(api.isMuted('g@g.us', null), false);
        assert.strictEqual(api.addMuted(null, '55@s.whatsapp.net'), false);
        assert.strictEqual(api.addMuted('g@g.us', null), false);
        assert.strictEqual(api.removeMuted(null, '55@s.whatsapp.net'), false);
    });
});
