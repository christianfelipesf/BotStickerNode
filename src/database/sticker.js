const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { Jimp } = require('jimp');
const { Image } = require('node-webpmux');
const webp = require('webp-converter');
const { tempDir } = require('./db');

async function addMetadata(buffer, pack, author) {
    try {
        const img = new Image();
        await img.load(buffer);
        const exif = Buffer.concat([
            Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]),
            Buffer.from(JSON.stringify({
                "sticker-pack-id": `bot-${crypto.randomBytes(4).toString('hex')}`,
                "sticker-pack-name": pack,
                "sticker-pack-publisher": author,
                "emojis": ["✅"]
            }), 'utf-8')
        ]);
        exif.writeUInt32LE(exif.length - 22, 14);
        img.exif = exif;
        return await img.save(null);
    } catch (e) {
        console.error('❌ [METADATA] Falha:', e.message);
        return buffer;
    }
}

async function mediaToSticker(buffer, mimeType, pack, author) {
    const mime = (mimeType || '').toLowerCase();
    const isVideo = mime.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `stk_in_${tempId}${isVideo ? '.mp4' : '.png'}`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.webp`);
    const cleanup = [inputPath, outputPath];

    try {
        if (!isVideo) {
            const image = await Jimp.read(buffer);
            image.resize({ w: 512, h: 512 });
            const pngBuffer = await image.getBuffer('image/png');
            fs.writeFileSync(inputPath, pngBuffer);
            await webp.cwebp(inputPath, outputPath, "-q 60");
        } else {
            fs.writeFileSync(inputPath, buffer);
            const stats = fs.statSync(inputPath);
            if (!stats.size) throw new Error('Vídeo vazio');

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .inputOptions(['-t 6'])
                    .outputOptions([
                        '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=12,setsar=1',
                        '-c:v', 'libwebp',
                        '-lossless', '0',
                        '-q:v', '60',
                        '-preset', 'default',
                        '-loop', '0',
                        '-an',
                        '-fps_mode', 'vfr'
                    ])
                    .toFormat('webp')
                    .on('end', resolve)
                    .on('error', reject)
                    .save(outputPath);
            });

            const outStat = fs.statSync(outputPath);
            if (outStat.size < 512) {
                try { fs.unlinkSync(outputPath); } catch (_) {}
                throw new Error('Vídeo gerou WebP vazio/inválido');
            }
            const header = fs.readFileSync(outputPath).slice(0, 12);
            if (header.slice(0, 4).toString() !== 'RIFF' || header.slice(8, 12).toString() !== 'WEBP') {
                try { fs.unlinkSync(outputPath); } catch (_) {}
                throw new Error('Vídeo gerou arquivo não-WebP');
            }
        }

        const result = await addMetadata(fs.readFileSync(outputPath), pack, author);
        if (!result || result.length < 512) {
            throw new Error('Falha ao injetar metadados do sticker');
        }
        return result;
    } catch (error) {
        console.error('❌ [CONVERSÃO] Falha:', error.message);
        if (isVideo && fs.existsSync(inputPath)) {
            const firstFrameWebp = path.join(tempDir, `stk_fb_${tempId}.webp`);
            cleanup.push(firstFrameWebp);
            try {
                await new Promise((resolve, reject) => {
                    ffmpeg(inputPath)
                        .outputOptions([
                            '-vframes', '1',
                            '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1',
                            '-c:v', 'libwebp',
                            '-lossless', '0',
                            '-q:v', '60',
                            '-preset', 'default',
                            '-loop', '0',
                            '-an'
                        ])
                        .toFormat('webp')
                        .on('end', resolve)
                        .on('error', reject)
                        .save(firstFrameWebp);
                });
                if (fs.existsSync(firstFrameWebp) && fs.statSync(firstFrameWebp).size >= 64) {
                    const fallback = await addMetadata(fs.readFileSync(firstFrameWebp), pack, author);
                    if (fallback && fallback.length >= 64) return fallback;
                }
            } catch (fbErr) {
                console.error('❌ [CONVERSÃO] Fallback estático falhou:', fbErr.message);
            }
        }
        throw error;
    } finally {
        cleanup.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
    }
}

async function stickerToMedia(buffer, isAnimated = false) {
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `stk_in_${tempId}.webp`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.${isAnimated ? 'mp4' : 'png'}`);
    try {
        fs.writeFileSync(inputPath, buffer);
        await new Promise((resolve, reject) => {
            let ff = ffmpeg(inputPath);
            if (isAnimated) ff.outputOptions(['-pix_fmt yuv420p', '-c:v libx264', '-crf 18', '-preset slow', '-movflags +faststart', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2']).toFormat('mp4');
            else ff.outputOptions(['-vcodec png', '-compression_level 0', '-f image2']);
            ff.on('end', resolve).on('error', reject).save(outputPath);
        });
        return { buffer: fs.readFileSync(outputPath), mime: isAnimated ? 'video/mp4' : 'image/png', ext: isAnimated ? 'mp4' : 'png' };
    } catch (err) {
        console.error('❌ [FFMPEG] Falha:', err.message);
        throw err;
    } finally {
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
    }
}

async function changeSpeed(buffer, mimeType, speed = 1.0, voiceEffects = true) {
    const isVideo = mimeType.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `speed_in_${tempId}${isVideo ? '.mp4' : '.ogg'}`);
    const outputPath = path.join(tempDir, `speed_out_${tempId}${isVideo ? '.mp4' : '.opus'}`);
    try {
        fs.writeFileSync(inputPath, buffer);
        await new Promise((resolve, reject) => {
            let ff = ffmpeg(inputPath);
            let audioFilter = `atempo=${speed}`;
            if (voiceEffects) {
                const rate = 44100 * speed;
                audioFilter = `asetrate=${rate},atempo=1.0`;
            }
            if (isVideo) {
                const pts = 1 / speed;
                ff.outputOptions([
                    `-filter:v setpts=${pts}*PTS`,
                    `-filter:a ${audioFilter}`,
                    '-c:v libx264',
                    '-preset fast',
                    '-c:a aac',
                    '-movflags +faststart'
                ]);
            } else {
                ff.outputOptions([
                    `-filter:a ${audioFilter}`,
                    '-c:a libopus',
                    '-b:a 48k',
                    '-vbr on',
                    '-compression_level 10'
                ]).toFormat('ogg');
            }
            ff.on('end', resolve).on('error', reject).save(outputPath);
        });
        return fs.readFileSync(outputPath);
    } catch (e) {
        console.error('❌ [SPEED] Falha:', e.message);
        throw e;
    } finally {
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
    }
}

module.exports = {
    addMetadata,
    mediaToSticker,
    stickerToMedia,
    changeSpeed
};
