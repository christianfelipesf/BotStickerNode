const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Jimp } = require('jimp');
const { loadFont, FONT_SANS_16_WHITE, FONT_SANS_32_WHITE, FONT_SANS_64_WHITE } = require('@jimp/js-fonts');
const { measureText, measureTextHeight } = require('@jimp/plugin-print');
const ffmpeg = require('fluent-ffmpeg');
const { mediaToSticker } = require('../database/sticker');
const { tempDir } = require('../database/db');

async function makeAnimatedTextSticker(text) {
    const id = crypto.randomBytes(4).toString('hex');
    const frameDir = path.join(tempDir, `stext_${id}`);
    fs.mkdirSync(frameDir, { recursive: true });

    const W = 512, H = 512;
    const fontKey = text.length <= 10 ? FONT_SANS_64_WHITE : text.length <= 25 ? FONT_SANS_32_WHITE : FONT_SANS_16_WHITE;
    const font = await loadFont(fontKey);

    const maxW = W - 60;
    const textH = measureTextHeight(font, text, maxW);
    const textY = Math.max(10, (H - textH) / 2);

    const fps = 10;
    const holdFrames = 6;
    const charsPerStep = Math.max(1, Math.ceil(text.length / 30));
    const steps = Math.ceil(text.length / charsPerStep);
    const total = steps + holdFrames;

    for (let i = 0; i < total; i++) {
        const img = new Jimp({ width: W, height: H, color: 0x1a1a2eff });

        const show = i < steps
            ? text.substring(0, Math.min((i + 1) * charsPerStep, text.length))
            : text;

        const lineW = measureText(font, show);
        const drawX = (W - Math.min(lineW, maxW)) / 2;
        img.print({ font, x: drawX, y: textY, text: show, maxWidth: maxW });

        await img.writeAsync(path.join(frameDir, `f_${String(i).padStart(4, '0')}.png`));
    }

    const videoPath = path.join(tempDir, `stext_vid_${id}.mp4`);
    await new Promise((resolve, reject) => {
        ffmpeg(path.join(frameDir, 'f_%04d.png'))
            .inputOptions(['-framerate', String(fps)])
            .outputOptions([
                '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-vf', 'scale=512:512,setsar=1',
                '-movflags', '+faststart'
            ])
            .on('end', resolve)
            .on('error', reject)
            .save(videoPath);
    });

    const buf = fs.readFileSync(videoPath);
    const sticker = await mediaToSticker(buf, 'video/mp4', 'Texto Animado', 'Bot');

    fs.rmSync(frameDir, { recursive: true, force: true });
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
