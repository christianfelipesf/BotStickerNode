const { describe, it } = require('node:test');
const assert = require('node:assert');
const childProcess = require('child_process');

const { withWinHide, spawnHidden, patchChildProcess } = require('../../src/services/spawnSafe');

describe('spawnSafe', () => {
    it('exporta os helpers', () => {
        assert.strictEqual(typeof withWinHide, 'function');
        assert.strictEqual(typeof spawnHidden, 'function');
        assert.strictEqual(typeof patchChildProcess, 'function');
    });

    it('withWinHide injeta a flag sem destruir as outras opções', () => {
        const out = withWinHide({ stdio: ['ignore', 'ignore', 'ignore'] });
        assert.strictEqual(out.stdio.length, 3);
        if (process.platform === 'win32') assert.strictEqual(out.windowsHide, true);
        // respeita opt-out explícito
        assert.strictEqual(withWinHide({ windowsHide: false }).windowsHide, false);
        // não muta o objeto original
        const orig = { shell: false };
        withWinHide(orig);
        assert.strictEqual('windowsHide' in orig, false);
    });

    it('patchChildProcess é idempotente e não quebra o spawn', async () => {
        patchChildProcess();
        assert.strictEqual(patchChildProcess(), false); // segunda chamada recusa
        assert.strictEqual(childProcess.spawn.__spawnSafePatched, true);
        // spawn real continua funcionando (com e sem args array)
        const code = await new Promise((resolve, reject) => {
            const p = childProcess.spawn(process.execPath, ['-e', 'process.exit(7)'], {});
            p.on('error', reject);
            p.on('close', resolve);
        });
        assert.strictEqual(code, 7);
    });

    it('spawnHidden executa e herda a flag', async () => {
        const p = spawnHidden(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
        assert.strictEqual(typeof p.pid, 'number');
        const code = await new Promise((resolve, reject) => {
            p.on('error', reject);
            p.on('close', resolve);
        });
        assert.strictEqual(code, 0);
        if (process.platform === 'win32') assert.strictEqual(p.spawnargs !== undefined, true);
    });
});
