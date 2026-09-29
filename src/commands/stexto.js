const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const axios = require('axios');
const sharp = require('sharp');
const opentype = require('opentype.js');
const { addMetadata } = require('../database/sticker');
const { tempDir } = require('../database/db');
const { withChannelContext } = require('../services/channelPromo');

const FONT_DIR = path.join(process.cwd(), 'fonts');
const FONT_PATH = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_URL = 'https://github.com/prawnpdf/prawn/raw/master/data/fonts/DejaVuSans.ttf';

// Limite folgado do WhatsApp para sticker animado (~500KB)
const MAX_ANIMATED_BYTES = 460800;

async function ensureFont() {
    if (fs.existsSync(FONT_PATH)) return;
    fs.mkdirSync(FONT_DIR, { recursive: true });
    const res = await axios.get(FONT_URL, { responseType: 'arraybuffer', timeout: 15000, maxContentLength: 5*1024*1024, maxBodyLength: 5*1024*1024 });
    if (res.data.byteLength > 5*1024*1024) throw new Error('Fonte muito grande');
    fs.writeFileSync(FONT_PATH, Buffer.from(res.data));
}

let cachedFont = null;
async function loadFont() {
    if (cachedFont) return cachedFont;
    await ensureFont();
    const buf = fs.readFileSync(FONT_PATH);
    cachedFont = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    return cachedFont;
}

// Largura real em pixels via avanços dos glifos (determinístico, independe
// de fonte instalada no sistema — o renderer do sharp/librsvg não enxerga
// o TTF local, por isso o texto vira paths vetoriais via opentype.js).
function textWidth(font, text, fontSize) {
    return font.getAdvanceWidth(String(text), fontSize);
}

// Quebra o texto em linhas que cabem na largura máxima. Devolve array de linhas.
function wrapToWidth(font, text, maxW, fontSize) {
    const lines = String(text).split('\n');
    const result = [];
    for (const line of lines) {
        const words = line.split(' ');
        let cur = '';
        for (const w of words) {
            const test = cur ? cur + ' ' + w : w;
            if (textWidth(font, test, fontSize) > maxW && cur) {
                result.push(cur);
                cur = w;
            } else {
                cur = test;
            }
        }
        if (cur) result.push(cur);
    }
    return result;
}

function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const hex = n => Math.round(255 * f(n)).toString(16).padStart(2, '0');
    return '#' + hex(0) + hex(8) + hex(4);
}

// Monta o SVG de um frame: texto centralizado como paths vetoriais (o texto
// do usuário nunca aparece como XML — sem risco de escaping/injeção) com
// glow na cor do frame via feDropShadow (glow=false = texto sólido).
function buildFrameSvg(font, lines, fontSize, color, W, H, glow = true) {
    const scale = fontSize / font.unitsPerEm;
    const ascent = font.ascender * scale;
    const lineH = fontSize * 1.3;
    const totalH = lines.length * lineH;
    let baseline = (H - totalH) / 2 + ascent;
    const paths = lines.map((line) => {
        const adv = textWidth(font, line, fontSize);
        const x = (W - adv) / 2;
        const d = font.getPath(line, x, baseline, fontSize).toPathData(2);
        baseline += lineH;
        return `<path d="${d}"/>`;
    }).join('');
    if (!glow) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
            + `<g fill="${color}">${paths}</g></svg>`;
    }
    const glowR = Math.max(2, Math.round(fontSize / 12));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
        + `<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%">`
        + `<feDropShadow dx="0" dy="0" stdDeviation="${glowR}" flood-color="${color}" flood-opacity="0.9"/>`
        + `</filter></defs>`
        + `<g fill="${color}" filter="url(#glow)">${paths}</g></svg>`;
}

// Monta WebP animado a partir da sequência de PNGs. O ffmpeg aqui é só
// encoder (sem filtros de texto) — operação trivial e estável.
function encodeWebp(framePattern, fps, outputPath, extraArgs = [], timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (err) => { if (!done) { done = true; err ? reject(err) : resolve(); } };
        let stderr = '';
        let ff = null;
        const to = setTimeout(() => { try { ff && ff.kill('SIGKILL'); } catch (_) {} finish(new Error('ffmpeg stexto timeout')); }, timeoutMs);
        ff = spawn('ffmpeg', [
            '-y',
            '-v', 'error',
            '-framerate', String(fps),
            '-i', framePattern,
            '-c:v', 'libwebp',
            '-lossless', '0',
            '-quality', '80',
            ...extraArgs,
            '-pix_fmt', 'yuva420p',
            '-loop', '0',
            '-an',
            outputPath
        ], { windowsHide: true });
        ff.on('error', (e) => { clearTimeout(to); finish(e); });
        if (ff.stderr) ff.stderr.on('data', (d) => { stderr += d.toString(); if (stderr.length > 4000) stderr = stderr.slice(-4000); });
        ff.on('close', (code) => {
            clearTimeout(to);
            if (code === 0 && fs.existsSync(outputPath)) return finish();
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
            finish(new Error(`ffmpeg stexto exit ${code}: ${stderr.trim().slice(-300) || 'sem stderr'}`));
        });
    });
}

async function makeGlowSticker(text) {
    const id = crypto.randomBytes(4).toString('hex');
    const font = await loadFont();

    const W = 512, H = 512;
    const pad = 24;
    const maxW = W - pad * 2;

    // Encontra o maior tamanho de fonte que cabe na área (métricas reais)
    let fontSize = 72;
    let lines = [text];
    for (; fontSize >= 24; fontSize -= 4) {
        lines = wrapToWidth(font, text, maxW, fontSize);
        const textH = lines.length * fontSize * 1.3;
        const longest = lines.reduce((a, b) => textWidth(font, a, fontSize) > textWidth(font, b, fontSize) ? a : b, '');
        if (textWidth(font, longest, fontSize) <= maxW && textH <= H - pad * 2) break;
    }
    if (fontSize < 24) {
        fontSize = 24;
        lines = wrapToWidth(font, text, maxW, 24);
    }

    const fps = 12;
    const duration = 2;
    const totalFrames = Math.round(fps * duration);

    // Ângulo dourado (~137.5°) — cada frame tem uma cor MUITO diferente do anterior
    const colors = Array.from({ length: totalFrames }, (_, i) => hsl((i * 137.508) % 360, 100, 65));

    // Rasteriza cada frame via sharp (SVG -> PNG, com supersampling p/ nitidez)
    const framePaths = [];
    const outputPath = path.join(tempDir, `stext_${id}.webp`);
    try {
        for (let n = 0; n < totalFrames; n++) {
            const svg = buildFrameSvg(font, lines, fontSize, colors[n], W, H);
            const out = path.join(tempDir, `stext_${id}_f${String(n).padStart(2, '0')}.png`);
            await sharp(Buffer.from(svg), { density: 144 }).resize(W, H, { fit: 'fill' }).png().toFile(out);
            framePaths.push(out);
        }

        const framePattern = path.join(tempDir, `stext_${id}_f%02d.png`);
        // Sticker animado precisa caber no limite do WhatsApp. Como cada
        // frame tem cor própria (redundância temporal ~zero), a alavanca que
        // funciona é a contagem de frames — qualidade quase não move o tamanho.
        // Cadeia: 24 frames com glow -> 12 frames com glow -> 12 frames sólido.
        let buf = null;
        await encodeWebp(framePattern, fps, outputPath, []);
        buf = fs.readFileSync(outputPath);
        if (buf.length > MAX_ANIMATED_BYTES) {
            const halfPattern = path.join(tempDir, `stext_${id}_g%02d.png`);
            const halfPaths = [];
            try {
                for (let n = 0; n < totalFrames; n += 2) {
                    const dst = path.join(tempDir, `stext_${id}_g${String(n / 2).padStart(2, '0')}.png`);
                    fs.copyFileSync(framePaths[n], dst);
                    halfPaths.push(dst);
                }
                await encodeWebp(halfPattern, fps, outputPath, []);
                buf = fs.readFileSync(outputPath);
            } finally {
                for (const f of halfPaths) { try { fs.unlinkSync(f); } catch (_) {} }
            }
        }
        if (buf.length > MAX_ANIMATED_BYTES) {
            // Último recurso: texto sólido (sem blur do glow) em 12 frames
            const solidPaths = [];
            try {
                for (let n = 0; n < totalFrames; n += 2) {
                    const svg = buildFrameSvg(font, lines, fontSize, colors[n], W, H, false);
                    const out = path.join(tempDir, `stext_${id}_s${String(n / 2).padStart(2, '0')}.png`);
                    await sharp(Buffer.from(svg), { density: 144 }).resize(W, H, { fit: 'fill' }).png().toFile(out);
                    solidPaths.push(out);
                }
                await encodeWebp(path.join(tempDir, `stext_${id}_s%02d.png`), fps, outputPath, []);
                buf = fs.readFileSync(outputPath);
            } finally {
                for (const f of solidPaths) { try { fs.unlinkSync(f); } catch (_) {} }
            }
        }
        const withMeta = await addMetadata(buf, 'Texto Glow', 'Bot');
        return withMeta;
    } finally {
        for (const f of framePaths) { try { fs.unlinkSync(f); } catch (_) {} }
        try { fs.unlinkSync(outputPath); } catch (_) {}
    }
}

module.exports = {
    name: 'stexto',
    aliases: ['textsticker', 'textstick', 'txtsticker'],
    category: 'mídia',
    description: 'Cria sticker animado com texto brilhante e glow colorido',
    async execute(sock, m, { from, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getMessageText } = utils;

        let text = args.join(' ').trim();
        if (!text && m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            text = getMessageText(m.message.extendedTextMessage.contextInfo.quotedMessage);
        }
        if (!text) text = getMessageText(m.message);

        if (!text || text.length === 0) {
            return await sock.sendMessage(from, { text: '❌ Digite o texto ou marque uma mensagem para criar o sticker glow.' }, { quoted: m });
        }
        if (text.length > 200) {
            return await sock.sendMessage(from, { text: '❌ Texto muito longo. Máximo 200 caracteres.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '✨', lastBotResponse, GLOBAL_COOLDOWN);

        try {
            const sticker = await makeGlowSticker(text);
            let channelCfg = null;
            try { channelCfg = require('../database/utils').readConfig(); } catch (_) {}
            await sock.sendMessage(from, withChannelContext({ sticker }, channelCfg), { quoted: m });
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (error) {
            console.error('❌ [STEXTO] Erro:', error.message);
            await sock.sendMessage(from, { text: '❌ Erro ao criar sticker glow. Tente novamente.' }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    },
    // Expostos para testes unitários
    _helpers: { textWidth, wrapToWidth, hsl, buildFrameSvg, loadFont }
};
