const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const { mediaToSticker } = require('../database/sticker');
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
    return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

function wrapText(text, maxChars) {
    const inputLines = text.split('\n');
    const result = [];
    for (const inputLine of inputLines) {
        const words = inputLine.split(' ');
        let line = '';
        for (const w of words) {
            const test = line ? line + ' ' + w : w;
            if (test.length > maxChars && line) {
                result.push(line);
                line = w;
            } else {
                line = test;
            }
        }
        if (line) result.push(line);
    }
    return result.join('\\n');
}

async function makeAnimatedTextSticker(text) {
    const id = crypto.randomBytes(4).toString('hex');
    await ensureFont();

    const W = 512, H = 512;
    const fontSize = text.length <= 12 ? 52 : text.length <= 30 ? 36 : 24;
    const maxLineChars = text.length <= 12 ? 12 : 18;
    const displayText = wrapText(text, maxLineChars);

    const charPace = text.length <= 15 ? 0.18 : text.length <= 40 ? 0.10 : 0.06;
    const holdSec = 0.8;
    const totalSec = Math.max(2, Math.min(6, Math.ceil(text.length * charPace + holdSec)));

    const typingSec = totalSec - holdSec;
    const steps = Math.min(Math.max(10, Math.ceil(text.length / 2)), 35);
    const stepSec = typingSec / steps;
    const charsPerStep = Math.ceil(text.length / steps);
    const filters = [];

    for (let i = 0; i < steps; i++) {
        const partial = text.substring(0, Math.min((i + 1) * charsPerStep, text.length));
        const wrapped = wrapText(partial, maxLineChars);
        const t0 = +(i * stepSec).toFixed(3);
        const t1 = +((i + 1) * stepSec).toFixed(3);
        filters.push(`drawtext=text='${escapeDrawtext(wrapped)}':fontfile=${FONT_PATH.replace(/\\/g, '/')}:fontsize=${fontSize}:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:enable='between(t,${t0},${t1})'`);
    }

    const escapedFull = escapeDrawtext(displayText);
    filters.push(`drawtext=text='${escapedFull}':fontfile=${FONT_PATH.replace(/\\/g, '/')}:fontsize=${fontSize}:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:enable='between(t,${typingSec},${totalSec})'`);

    const videoPath = path.join(tempDir, `stext_vid_${id}.mp4`);
    await new Promise((resolve, reject) => {
        ffmpeg()
            .input(`color=c=#1a1a2e:s=${W}x${H}:d=${totalSec}`)
            .inputFormat('lavfi')
            .outputOptions([
                '-vf', filters.join(','),
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart'
            ])
            .on('end', resolve)
            .on('error', reject)
            .save(videoPath);
    });

    const buf = fs.readFileSync(videoPath);
    const sticker = await mediaToSticker(buf, 'video/mp4', 'Texto Animado', 'Bot');
    fs.unlinkSync(videoPath);
    return sticker;
}

module.exports = {
    name: 'stexto',
    aliases: ['textsticker', 'textstick', 'txtsticker'],
    category: 'mídia',
    description: 'Cria um sticker animado com texto digitando',
    async execute(sock, m, { from, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getMessageText } = utils;

        let text = args.join(' ').trim();

        if (!text && m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            text = getMessageText(m.message.extendedTextMessage.contextInfo.quotedMessage);
        }
        if (!text) {
            text = getMessageText(m.message);
        }

        if (!text || text.length === 0) {
            return await sock.sendMessage(from, { text: '❌ Digite o texto ou marque uma mensagem para converter em sticker animado.' }, { quoted: m });
        }

        if (text.length > 200) {
            return await sock.sendMessage(from, { text: '❌ Texto muito longo. Máximo 200 caracteres.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '⏳', lastBotResponse, GLOBAL_COOLDOWN);

        try {
            const sticker = await makeAnimatedTextSticker(text);
            await sock.sendMessage(from, { sticker }, { quoted: m });
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (error) {
            console.error('❌ [STEXTO] Erro:', error.message);
            await sock.sendMessage(from, { text: '❌ Erro ao criar sticker animado. Tente um texto mais curto.' }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
