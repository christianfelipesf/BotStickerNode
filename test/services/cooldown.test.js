const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

describe('cooldown', () => {
    let cooldown;

    beforeEach(() => {
        delete require.cache[require.resolve('../../src/services/cooldown')];
        cooldown = require('../../src/services/cooldown');
    });

    it('deve exportar funções principais', () => {
        assert.strictEqual(typeof cooldown.checkCooldown, 'function');
        assert.strictEqual(typeof cooldown.clearCooldown, 'function');
        assert.strictEqual(typeof cooldown.clearAllCooldowns, 'function');
        assert.strictEqual(typeof cooldown.getEffectiveCooldownMs, 'function');
    });

    it('checkCooldown deve retornar 0 na primeira chamada', () => {
        const result = cooldown.checkCooldown('test', 'user1');
        assert.strictEqual(result, 0);
    });

    it('checkCooldown deve retornar >0 na segunda chamada imediata', () => {
        cooldown.checkCooldown('test', 'user1');
        const result = cooldown.checkCooldown('test', 'user1');
        assert.ok(result > 0);
    });

    it('cooldown deve ser por usuário (user1 não afeta user2)', () => {
        cooldown.checkCooldown('test', 'user1');
        const result = cooldown.checkCooldown('test', 'user2');
        assert.strictEqual(result, 0);
    });

    it('cooldown deve ser por comando (cmd1 não afeta cmd2)', () => {
        cooldown.checkCooldown('cmd1', 'user1');
        const result = cooldown.checkCooldown('cmd2', 'user1');
        assert.strictEqual(result, 0);
    });

    it('clearCooldown deve resetar o cooldown', () => {
        cooldown.checkCooldown('test', 'user1');
        cooldown.clearCooldown('test', 'user1');
        const result = cooldown.checkCooldown('test', 'user1');
        assert.strictEqual(result, 0);
    });

    it('clearAllCooldowns deve resetar todos', () => {
        cooldown.checkCooldown('test1', 'user1');
        cooldown.checkCooldown('test2', 'user2');
        cooldown.clearAllCooldowns();
        assert.strictEqual(cooldown.checkCooldown('test1', 'user1'), 0);
        assert.strictEqual(cooldown.checkCooldown('test2', 'user2'), 0);
    });

    it('getEffectiveCooldownMs deve retornar cooldown específico para sticker', () => {
        assert.strictEqual(cooldown.getEffectiveCooldownMs('s'), 3000);
        assert.strictEqual(cooldown.getEffectiveCooldownMs('sticker'), 3000);
    });

    it('getEffectiveCooldownMs deve retornar default para comando desconhecido', () => {
        assert.strictEqual(cooldown.getEffectiveCooldownMs('comando_inexistente'), 2000);
    });

    it('getEffectiveCooldownMs deve retornar cooldown específico para divulgar', () => {
        assert.strictEqual(cooldown.getEffectiveCooldownMs('divulgar'), 60000);
    });

    it('getRemainingSeconds deve retornar 0 se não estiver em cooldown', () => {
        assert.strictEqual(cooldown.getRemainingSeconds('test', 'user1'), 0);
    });

    it('getRemainingSeconds deve retornar >0 se estiver em cooldown', () => {
        cooldown.checkCooldown('test', 'user1');
        assert.ok(cooldown.getRemainingSeconds('test', 'user1') > 0);
    });

    it('checkCooldown deve retornar 0 para commandName vazio', () => {
        assert.strictEqual(cooldown.checkCooldown('', 'user1'), 0);
        assert.strictEqual(cooldown.checkCooldown(null, 'user1'), 0);
    });

    it('checkCooldown deve retornar 0 para userId vazio', () => {
        assert.strictEqual(cooldown.checkCooldown('test', ''), 0);
        assert.strictEqual(cooldown.checkCooldown('test', null), 0);
    });
});
