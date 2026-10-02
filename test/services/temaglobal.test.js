const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isola o banco: database/utils abre o SQLite no require.
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'temaglobal-test-')), 'bot.db');
process.env.BOT_DB_PATH = tmpDb;

let utils;
let themes;
let partial;
before(() => {
    utils = require('../../src/database/utils');
    themes = require('../../src/services/themes');
    partial = require('../../src/events/partial');
});

describe('temaglobal — tema halloween', () => {
    it('halloween existe com estrutura completa', () => {
        const t = themes.getTheme('halloween');
        assert.strictEqual(t.id, 'halloween');
        assert.ok(t.label.includes('Halloween'));
        assert.ok(t.menuTitle && t.rankTitle && t.botSuffix);
        assert.ok(t.colors && t.colors.accent);
        assert.ok(t.phrases && t.phrases.activated);
    });

    it('aliases haloween/bruxas resolvem', () => {
        assert.strictEqual(themes.normalizeThemeId('haloween'), 'halloween');
        assert.strictEqual(themes.normalizeThemeId('bruxas'), 'halloween');
        assert.strictEqual(themes.normalizeThemeId('HALLOWEEN'), 'halloween');
    });

    it('listThemes inclui halloween', () => {
        assert.ok(themes.listThemes().some(t => t.id === 'halloween'));
    });

    it('reações do halloween seguem o tema (usadas pelo !s)', () => {
        const t = themes.getTheme('halloween');
        assert.strictEqual(t.ok, '🍬');
        assert.strictEqual(t.err, '💀');
        assert.strictEqual(t.react, '🎃');
    });
});

describe('temaglobal — tema dark sem corações', () => {
    it('dark não usa 🖤 em nenhum slot visível', () => {
        const d = themes.getTheme('dark');
        const visible = JSON.stringify({ ...d, legacySuffixes: undefined });
        assert.ok(!visible.includes('🖤'), 'coração ainda visível no dark!');
        assert.strictEqual(d.botSuffix, '🌑💀');
    });

    it('sufixo legado 🖤💀 é limpo na troca/reset', () => {
        let n = 'Meu Bot 🖤💀';
        for (const x of Object.values(themes.THEMES)) {
            if (x.botSuffix) n = n.split(x.botSuffix).join('').trim();
            for (const leg of (x.legacySuffixes || [])) n = n.split(leg).join('').trim();
        }
        assert.strictEqual(n, 'Meu Bot');
    });
});

describe('temaglobal — fallback grupo > global > default', () => {
    it('sem nada: default', () => {
        assert.strictEqual(utils.getGlobalTheme(), 'default');
        assert.strictEqual(utils.getThemeForJid('12345@g.us'), 'default');
    });

    it('global ativo cobre grupo sem tema próprio', () => {
        assert.strictEqual(utils.setGlobalTheme('halloween'), 'halloween');
        assert.strictEqual(utils.getGlobalTheme(), 'halloween');
        assert.strictEqual(utils.getThemeForJid('12345@g.us'), 'halloween');
        // PV também herda o global
        assert.strictEqual(utils.getThemeForJid('5511999999999@s.whatsapp.net'), 'halloween');
    });

    it('tema próprio do grupo vence o global', () => {
        utils.setGroupData('12345@g.us', { theme: 'natal' });
        assert.strictEqual(utils.getThemeForJid('12345@g.us'), 'natal');
        utils.setGroupData('12345@g.us', { theme: null });
        assert.strictEqual(utils.getThemeForJid('12345@g.us'), 'halloween');
    });

    it('off volta ao padrão; tema inválido é rejeitado', () => {
        assert.strictEqual(utils.setGlobalTheme('inexistente'), false);
        assert.strictEqual(utils.getGlobalTheme(), 'halloween');
        assert.strictEqual(utils.clearGlobalTheme(), true);
        assert.strictEqual(utils.getGlobalTheme(), 'default');
        assert.strictEqual(utils.getThemeForJid('12345@g.us'), 'default');
    });

    it('gestão do temaglobal é bloqueada no parcial', () => {
        for (const c of ['temaglobal', 'globaltema', 'temaglob']) {
            assert.ok(partial.PARTIAL_BLOCKED_COMMANDS.has(c), `deveria conter ${c}`);
        }
    });
});
