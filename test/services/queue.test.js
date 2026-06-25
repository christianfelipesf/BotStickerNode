const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

describe('queue service', () => {
    let queue;

    before(() => {
        queue = require('../../src/services/queue');
    });

    it('deve exportar as funções esperadas', () => {
        assert.strictEqual(typeof queue.enqueueDownload, 'function');
        assert.strictEqual(typeof queue.enqueueSend, 'function');
        assert.strictEqual(typeof queue.enqueueProcess, 'function');
        assert.strictEqual(typeof queue.queueSize, 'function');
    });

    it('deve executar função na fila de download', async () => {
        const result = await queue.enqueueDownload(() => Promise.resolve('ok'));
        assert.strictEqual(result, 'ok');
    });

    it('deve executar função na fila de send', async () => {
        const result = await queue.enqueueSend(() => Promise.resolve(42));
        assert.strictEqual(result, 42);
    });

    it('deve executar função na fila de process', async () => {
        const result = await queue.enqueueProcess(() => Promise.resolve({ a: 1 }));
        assert.deepStrictEqual(result, { a: 1 });
    });

    it('deve reportar tamanho das filas', () => {
        const size = queue.queueSize();
        assert.strictEqual(typeof size.download, 'number');
        assert.strictEqual(typeof size.send, 'number');
        assert.strictEqual(typeof size.process, 'number');
        assert.strictEqual(typeof size.pending, 'number');
    });

    it('deve propagar erros corretamente', async () => {
        await assert.rejects(
            () => queue.enqueueDownload(() => Promise.reject(new Error('fail'))),
            { message: 'fail' }
        );
    });
});
