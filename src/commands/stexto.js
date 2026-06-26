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

function escapeDrawtext(val) {
    return val
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/:/g, '\\:')
        .replace(/\n/g, '\\n');
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

    const fontfile = FONT_PATH.replace(/\\/g, '/');
    const escaped = escapeDrawtext(displayText);

    const fps = 10;
    const duration = 4;

    const outputPath = path.join(tempDir, `stext_${id}.webp`);
    await new Promise((resolve, reject) => {
        ffmpeg()
            .input(`color=c=#00000000:s=${W}x${H}:d=${duration}:r=${fps}`)
            .inputFormat('lavfi')
            .videoFilter([
                'format=yuva420p',
                `drawtext=text='${escaped}':fontfile=${fontfile}:fontcolor=white:bordercolor=#FF3366:borderw=8:fontsize=${fontSize}:x=(w-tw)/2:y=(h-th)/2`,
                'hue=H=t*360'
            ].join(','))
            .outputOptions([
                '-c:v', 'libwebp',
                '-lossless', '0',
                '-q:v', '80',
                '-pix_fmt', 'yuva420p',
                '-loop', '0',
                '-an'
            ])
            .on('end', resolve)
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
