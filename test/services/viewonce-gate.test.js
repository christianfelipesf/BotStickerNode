const { describe, it, before } = require('node:test');
const assert = require('node:assert');

process.env.BOT_DB_PATH = require('path').join(require('os').tmpdir(), `bot-test-visu-${process.pid}.db`);

const BOT = '999888777@s.whatsapp.net';
const ADMIN = '111222333@s.whatsapp.net';
const MEMBER = '444555666@lid';
const G = 'visugate@g.us';

function fakeSock() {
    return {
        user: { id: BOT },
        groupMetadata: async () => ({
            subject: 'G',
            participants: [
                { id: ADMIN, admin: 'admin' },
                { id: '444555666@s.whatsapp.net', lid: MEMBER }
            ]
        })
    };
}
const memberMsg = () => ({ key: { remoteJid: G, participant: MEMBER, id: 'm1' } });
const adminMsg = () => ({ key: { remoteJid: G, participant: ADMIN, id: 'a1' } });
const Q_VIEWONCE = { viewOnceMessageV2: { message: { imageMessage: { caption: '', mimetype: 'image/jpeg' } } } };
const Q_NORMAL = { imageMessage: { caption: 'foto normal', mimetype: 'image/jpeg' } };
const Q_REVEALED = { imageMessage: { caption: '╭─── *🔓 MÍDIA REVELADA* ───\n│ 👤 *De:* Ana', mimetype: 'image/jpeg' } };

describe('!revelaradmin — gate de reaproveitamento (shouldBlockViewOnceReuse)', () => {
    let gate;
    let utils;
    before(() => {
        utils = require('../../src/database/utils');
        utils.setGroupData(G, { revealAdminOnly: true });
        gate = require('../../src/events/media').shouldBlockViewOnceReuse;
    });

    it('membro + visu original + !s => bloqueia', async () => {
        const r = await gate({ sock: fakeSock(), from: G, requesterMsg: memberMsg(), quotedMsg: Q_VIEWONCE, quotedParticipant: '555@s.whatsapp.net', action: 'sticker' });
        assert.strictEqual(r.blocked, true);
        assert.strictEqual(r.reason, 'viewonce');
    });
    it('membro + visu original + !toimg => bloqueia', async () => {
        const r = await gate({ sock: fakeSock(), from: G, requesterMsg: memberMsg(), quotedMsg: Q_VIEWONCE, quotedParticipant: '555@s.whatsapp.net', action: 'toimg' });
        assert.strictEqual(r.blocked, true);
    });
    it('admin + visu original => libera', async () => {
        const r = await gate({ sock: fakeSock(), from: G, requesterMsg: adminMsg(), quotedMsg: Q_VIEWONCE, quotedParticipant: '555@s.whatsapp.net', action: 'sticker' });
        assert.strictEqual(r.blocked, false);
    });
    it('membro + foto normal => libera', async () => {
        const r = await gate({ sock: fakeSock(), from: G, requesterMsg: memberMsg(), quotedMsg: Q_NORMAL, quotedParticipant: '555@s.whatsapp.net', action: 'sticker' });
        assert.strictEqual(r.blocked, false);
    });
    it('membro + cópia revelada pelo bot + !s => bloqueia (o bug)', async () => {
        const r = await gate({ sock: fakeSock(), from: G, requesterMsg: memberMsg(), quotedMsg: Q_REVEALED, quotedParticipant: BOT, action: 'sticker' });
        assert.strictEqual(r.blocked, true);
        assert.strictEqual(r.reason, 'revealed-copy');
    });
    it('membro + cópia revelada + !toimg => bloqueia', async () => {
        const r = await gate({ sock: fakeSock(), from: G, requesterMsg: memberMsg(), quotedMsg: Q_REVEALED, quotedParticipant: BOT, action: 'toimg' });
        assert.strictEqual(r.blocked, true);
    });
    it('admin + cópia revelada => libera', async () => {
        const r = await gate({ sock: fakeSock(), from: G, requesterMsg: adminMsg(), quotedMsg: Q_REVEALED, quotedParticipant: BOT, action: 'sticker' });
        assert.strictEqual(r.blocked, false);
    });
    it('action reveal nunca bloqueia aqui (!revelar tem trava própria)', async () => {
        const r = await gate({ sock: fakeSock(), from: G, requesterMsg: memberMsg(), quotedMsg: Q_VIEWONCE, quotedParticipant: '555@s.whatsapp.net', action: 'reveal' });
        assert.strictEqual(r.blocked, false);
    });
    it('flag off => libera tudo', async () => {
        utils.setGroupData(G, { revealAdminOnly: false });
        const r = await gate({ sock: fakeSock(), from: G, requesterMsg: memberMsg(), quotedMsg: Q_VIEWONCE, quotedParticipant: '555@s.whatsapp.net', action: 'sticker' });
        assert.strictEqual(r.blocked, false);
        utils.setGroupData(G, { revealAdminOnly: true });
    });
});
