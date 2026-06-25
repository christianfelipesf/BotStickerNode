const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

describe('trace', () => {
    let trace;
    let originalLog;

    beforeEach(() => {
        originalLog = console.log;
        trace = require('../../src/services/trace');
    });

    afterEach(() => {
        console.log = originalLog;
    });

    it('ts() deve retornar timestamp no formato HH:MM:SS', () => {
        const result = trace.ts();
        assert.match(result, /^\d{2}:\d{2}:\d{2}$/);
    });

    it('patch() deve adicionar timestamp ao console.log', () => {
        const lines = [];
        console.log = (...args) => { lines.push(args.join(' ')); };

        trace.patch();
        console.log('teste');

        assert.ok(lines.length > 0);
        assert.match(lines[0], /^\[\d{2}:\d{2}:\d{2}\] teste$/);
    });

    it('patch() deve adicionar timestamp ao console.error', () => {
        const lines = [];
        const origError = console.error;
        console.error = (...args) => { lines.push(args.join(' ')); };

        trace.patch();
        console.error('erro');

        assert.ok(lines.length > 0);
        assert.match(lines[0], /^\[\d{2}:\d{2}:\d{2}\] erro$/);
    });
});
