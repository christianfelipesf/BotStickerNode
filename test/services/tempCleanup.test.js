const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const tempDir = path.join(process.cwd(), 'temp');

describe('tempCleanup', () => {
    let tempCleanup;

    beforeEach(() => {
        delete require.cache[require.resolve('../../src/services/tempCleanup')];
        tempCleanup = require('../../src/services/tempCleanup');
    });

    it('deve exportar cleanTemp e startTempCleanup', () => {
        assert.strictEqual(typeof tempCleanup.cleanTemp, 'function');
        assert.strictEqual(typeof tempCleanup.startTempCleanup, 'function');
    });

    it('cleanTemp não deve quebrar quando temp/ não existe', () => {
        const result = tempCleanup.cleanTemp(0);
        assert.strictEqual(result, 0);
    });

    it('cleanTemp deve limpar arquivos antigos em temp/', () => {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const oldFile = path.join(tempDir, 'old_test_file.txt');
        fs.writeFileSync(oldFile, 'conteudo antigo');

        const past = Date.now() - 100000;
        fs.utimesSync(oldFile, past / 1000, past / 1000);

        const result = tempCleanup.cleanTemp(5000);

        assert.ok(result >= 1);
        assert.ok(!fs.existsSync(oldFile));
    });

    it('startTempCleanup deve iniciar e retornar timer', () => {
        const timer = tempCleanup.startTempCleanup(60000, 1);
        assert.ok(timer);
        assert.strictEqual(typeof timer, 'object');
        clearInterval(timer);
    });
});
