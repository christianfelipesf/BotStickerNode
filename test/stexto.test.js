const { describe, it } = require('node:test');
const assert = require('node:assert');

const cmd = require('../src/commands/stexto.js');

describe('!stexto — helpers de layout/vetor', () => {
    it('expõe comando e helpers de teste', () => {
        assert.strictEqual(cmd.name, 'stexto');
        assert.ok(cmd._helpers && typeof cmd._helpers.buildFrameSvg === 'function');
    });

    it('hsl gera cores hexadecimais válidas e distintas', () => {
        const { hsl } = cmd._helpers;
        const a = hsl(0, 100, 65);
        const b = hsl(137.508, 100, 65);
        assert.match(a, /^#[0-9a-f]{6}$/);
        assert.match(b, /^#[0-9a-f]{6}$/);
        assert.notStrictEqual(a, b);
    });

    it('wrapToWidth quebra por largura real e preserva \\n', async () => {
        const { loadFont, wrapToWidth, textWidth } = cmd._helpers;
        const font = await loadFont();
        const lines = wrapToWidth(font, 'mlk | comedia ' + 'palavra '.repeat(30), 464, 72);
        assert.ok(lines.length > 1, 'texto longo deve quebrar em várias linhas');
        for (const ln of lines) {
            assert.ok(textWidth(font, ln, 72) <= 464, `linha estoura: ${ln}`);
        }
        const keep = wrapToWidth(font, 'a\nb', 464, 72);
        assert.deepStrictEqual(keep, ['a', 'b']);
    });

    it('buildFrameSvg embute paths (sem texto cru = sem risco XML) e glow', async () => {
        const { loadFont, buildFrameSvg } = cmd._helpers;
        const font = await loadFont();
        const evil = `<oi> & "aspas" 'x' 5>3`;
        const svg = buildFrameSvg(font, [evil], 72, '#ff0000', 512, 512);
        assert.ok(svg.includes('<path d="M'), 'deve conter paths vetoriais');
        assert.ok(!svg.includes(evil), 'texto do usuário não pode aparecer cru no XML');
        assert.ok(svg.includes('feDropShadow'), 'deve ter filtro de glow');
        assert.ok(svg.includes('flood-color="#ff0000"'), 'glow na cor do frame');
        const solid = buildFrameSvg(font, [evil], 72, '#00ff00', 512, 512, false);
        assert.ok(!solid.includes('feDropShadow'), 'glow=false não tem filtro');
        assert.ok(solid.includes('fill="#00ff00"'), 'texto sólido na cor do frame');
    });
});
