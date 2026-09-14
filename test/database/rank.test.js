// Testes de blindagem do rank: garantem que a contagem nunca se perde.
// Roda contra um banco TEMPORÁRIO (BOT_DB_PATH) — nunca toca no bot.db real.
process.env.BOT_DB_PATH = require('path').join(require('os').tmpdir(), `bot-test-rank-${process.pid}.db`);

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const u = require('../../src/database/utils');
const { db } = require('../../src/database/db');

const G = 'testrank@g.us';
const U1 = 'u1@s.whatsapp.net';
const U2 = 'u2@s.whatsapp.net';

function wipe() {
    try { db.prepare('DELETE FROM group_state WHERE jid = ?').run(G); } catch (_) {}
    try { db.prepare('DELETE FROM active_groups WHERE jid = ?').run(G); } catch (_) {}
    try { db.prepare('DELETE FROM active_groups_partial WHERE jid = ?').run(G); } catch (_) {}
}

after(() => {
    wipe();
    for (const suf of ['', '-shm', '-wal', '-journal']) {
        try { fs.unlinkSync(process.env.BOT_DB_PATH + suf); } catch (_) {}
    }
});

describe('rank — persistência (nunca perder contagem)', () => {
    it('acumula e persiste no banco (flush grava de verdade)', () => {
        wipe();
        u.updateMemberActivity(G, U1, 'Um');
        u.updateMemberActivity(G, U1, 'Um');
        u.updateMemberActivity(G, U2, 'Dois');
        const rank = u.getMonthlyRank(G, 10);
        assert.strictEqual(rank.length, 2);
        assert.strictEqual(rank[0].count, 2);
        // prova de persistência: lê a linha crua do banco
        const row = db.prepare('SELECT activity FROM group_state WHERE jid = ?').get(G);
        assert.ok(row, 'linha do grupo deve existir no banco após flush');
        const act = JSON.parse(row.activity)[G];
        assert.strictEqual(act[U1].count, 2);
        assert.strictEqual(act[U2].count, 1);
    });

    it('leituras repetidas retornam resultado idêntico (sem duplicar)', () => {
        const r1 = JSON.stringify(u.getMonthlyRank(G, 10));
        const r2 = JSON.stringify(u.getMonthlyRank(G, 10));
        const r3 = JSON.stringify(u.getMonthlyRank(G, 10));
        assert.strictEqual(r1, r2);
        assert.strictEqual(r2, r3);
    });

    it('atualiza o nome sem zerar a contagem', () => {
        u.updateMemberActivity(G, U1, 'Nome Novo');
        const rank = u.getMonthlyRank(G, 10);
        const me = rank.find(x => x.jid === U1);
        assert.strictEqual(me.name, 'Nome Novo');
        assert.ok(me.count >= 3, 'contagem deve acumular, nunca resetar');
    });

    it('nome genérico não apaga nome real', () => {
        u.updateMemberActivity(G, U1, 'Usuário');
        const me = u.getMonthlyRank(G, 10).find(x => x.jid === U1);
        assert.strictEqual(me.name, 'Nome Novo');
    });

    it('writeGroupState preserva colunas não alteradas (theme, prefix, etc)', () => {
        u.setGroupData(G, { theme: 'natal', prefix: '$' });
        u.updateMemberActivity(G, U2, 'Dois');
        u.flushNow();
        const gd = u.getGroupData(G);
        assert.strictEqual(gd.theme, 'natal', 'theme não pode ser apagado pelo flush');
        assert.strictEqual(gd.prefix, '$', 'prefix não pode ser apagado pelo flush');
        const rank = u.getMonthlyRank(G, 10);
        assert.ok(rank.length >= 2, 'activity deve sobreviver junto das outras colunas');
    });

    it('deactivate NÃO apaga o rank', () => {
        u.activateGroup(G);
        const before = JSON.stringify(u.getMonthlyRank(G, 10));
        assert.ok(JSON.parse(before).length > 0);
        u.deactivateGroup(G);
        const row = db.prepare('SELECT activity FROM group_state WHERE jid = ?').get(G);
        assert.ok(row, 'linha deve continuar existindo');
        const act = JSON.parse(row.activity)[G] || {};
        const total = Object.values(act).reduce((s, v) => s + (Number(v.count) || 0), 0);
        assert.ok(total > 0, 'activity deve ser preservada no deactivate');
        wipe();
    });

    it('reset mensal fotografa histórico antes de zerar', () => {
        wipe();
        u.updateMemberActivity(G, U1, 'Um');
        u.flushNow();
        const saved = u.snapshotMonthlyRanks('2000-01');
        assert.strictEqual(saved, 1);
        const hist = u.getRankHistory(G, '2000-01');
        assert.ok(hist, 'histórico deve existir');
        assert.strictEqual(hist.total, 1);
        assert.strictEqual(hist.data[U1].count, 1);
        db.prepare('DELETE FROM rank_monthly_history WHERE jid = ?').run(G);
        wipe();
    });

    it('checkMonthlyReset: mesmo mês não reseta; mês diferente reseta', () => {
        wipe();
        u.updateMemberActivity(G, U1, 'Um');
        u.flushNow();
        const same = u.checkMonthlyReset();
        assert.strictEqual(same.reset, false, 'mesmo mês nunca reseta');
        assert.ok(u.getMonthlyRank(G, 10).length > 0, 'dados intactos após noop');
        const cur = db.prepare("SELECT value FROM stats WHERE key = '_activityMonth'").get().value;
        db.prepare("UPDATE stats SET value = '2000-01' WHERE key = '_activityMonth'").run();
        const diff = u.checkMonthlyReset();
        assert.strictEqual(diff.reset, true, 'mês diferente deve resetar');
        assert.strictEqual(u.getMonthlyRank(G, 10).length, 0, 'zerado após reset');
        const hist = u.getRankHistory(G, '2000-01');
        assert.ok(hist && hist.total >= 1, 'reset deve deixar snapshot no histórico');
        db.prepare('UPDATE stats SET value = ? WHERE key = ?').run(cur, '_activityMonth');
        db.prepare('DELETE FROM rank_monthly_history WHERE jid = ?').run(G);
        wipe();
    });
});
