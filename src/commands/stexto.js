const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { addMetadata } = require('../database/sticker');
const { tempDir } = require('../database/db');

const FONT_DIR = path.join(process.cwd(), 'fonts');
const FONT_PATH = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_URL = 'https://github.com/prawnpdf/prawn/raw/master/data/fonts/DejaVuSans.ttf';

async function ensureFont() {
    if (fs.existsSync(FONT_PATH)) return;
    fs.mkdirSync(FONT_DIR, { recursive: true });
    const res = await axios.get(FONT_URL, { responseType: 'arraybuffer', timeout: 15000 });
    fs.writeFileSync(FONT_PATH, Buffer.from(res.data));
}

// Estima largura em pixels do texto para a fonte DejaVu Sans
function textWidth(text, fontSize) {
    return text.length * fontSize * 0.55;
}

// Quebra o texto em linhas que cabem na largura máxima
function wrapToWidth(text, maxW, fontSize) {
    const lines = text.split('\n');
    const result = [];
    for (const line of lines) {
        const words = line.split(' ');
        let cur = '';
        for (const w of words) {
            const test = cur ? cur + ' ' + w : w;
            if (textWidth(test, fontSize) > maxW && cur) {
                result.push(cur);
                cur = w;
            } else {
                cur = test;
            }
        }
        if (cur) result.push(cur);
    }
    return result.join('\n');
}

function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    const hex = n => Math.round(255 * f(n)).toString(16).padStart(2, '0');
    return '#' + hex(0) + hex(8) + hex(4);
}

async function makeGlowSticker(text) {
    const id = crypto.randomBytes(4).toString('hex');
    await ensureFont();

    const W = 512, H = 512;
    const pad = 24;
    const maxW = W - pad * 2;

    // Encontra o maior tamanho de fonte que cabe na área
    let fontSize = 72;
    let displayText = text;
    for (; fontSize >= 24; fontSize -= 4) {
        displayText = wrapToWidth(text, maxW, fontSize);
        const lines = displayText.split('\n');
        const textH = lines.length * fontSize * 1.3;
        const longest = lines.reduce((a, b) => a.length > b.length ? a : b, '');
        if (textWidth(longest, fontSize) <= maxW && textH <= H - pad * 2) break;
    }
    if (fontSize < 24) {
        fontSize = 24;
        displayText = wrapToWidth(text, maxW, 24);
    }

    // Texto em arquivo para evitar escaping de \n
    const textFile = path.join(tempDir, `stext_txt_${id}.txt`);
    fs.writeFileSync(textFile, displayText, 'utf8');

    const fontfile = FONT_PATH.replace(/\\/g, '/');
    const fps = 12;
    const duration = 2;
    const totalFrames = Math.round(fps * duration);

    // Ângulo dourado (~137.5°) — garante que cada frame tenha uma cor MUITO diferente do anterior
    const frames = Array.from({ length: totalFrames }, (_, i) => ({
        c: hsl((i * 137.508) % 360, 100, 50),
        n: i
    }));

    // Um drawtext por frame, cada um com cor imprevisível, sem transição
    const tpl = `drawtext=textfile='${textFile.replace(/\\/g, '/')}':fontfile=${fontfile}:fontsize=${fontSize}:x=(w-tw)/2:y=(h-th)/2:borderw=6:alpha=1`;
    const filters = frames.map(f =>
        `${tpl}:fontcolor=${f.c}:bordercolor=${f.c}:enable='eq(n,${f.n})'`
    );

    const outputPath = path.join(tempDir, `stext_${id}.webp`);
    await new Promise((resolve, reject) => {
        ffmpeg()
            .input(`nullsrc=s=${W}x${H}:r=${fps}:d=${duration}`)
            .inputFormat('lavfi')
            .videoFilter(['format=yuva420p', 'colorchannelmixer=aa=0', ...filters].join(','))
            .outputOptions([
                '-c:v', 'libwebp',
                '-lossless', '1',
                '-preset', 'picture',
                '-pix_fmt', 'yuva420p',
                '-loop', '0',
                '-an'
            ])
            .on('end', () => {
                try { fs.unlinkSync(textFile); } catch {}
                resolve();
            })
            .on('error', reject)
            .save(outputPath);
    });

    const buf = fs.readFileSync(outputPath);
    const withMeta = await addMetadata(buf, 'Texto Glow', 'Bot');
    fs.unlinkSync(outputPath);
    return withMeta;
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
            await sock.sendMessage(from, { sticker }, { quoted: m });
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (error) {
            console.error('❌ [STEXTO] Erro:', error.message);
            await sock.sendMessage(from, { text: '❌ Erro ao criar sticker glow. Tente novamente.' }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
