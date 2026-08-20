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
    if (!buffer || buffer.length > 10 * 1024 * 1024) throw new Error('Mídia muito grande (max 10MB)');
    const mime = (mimeType || '').toLowerCase();
    const isVideo = mime.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `stk_in_${tempId}${isVideo ? '.mp4' : '.png'}`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.webp`);
    const cleanup = [inputPath, outputPath];

    try {
        if (!isVideo) {
            const image = await Jimp.read(buffer);
            if (image.bitmap.width > 3000 || image.bitmap.height > 3000) throw new Error('Imagem muito grande');
            image.resize({ w: 512, h: 512 });
            const pngBuffer = await image.getBuffer('image/png');
            fs.writeFileSync(inputPath, pngBuffer);
            await webp.cwebp(inputPath, outputPath, "-q 60");
        } else {
            fs.writeFileSync(inputPath, buffer);
            let stats; try { stats = fs.statSync(inputPath); } catch (_) { throw new Error('Vídeo vazio'); }
            if (!stats.size) throw new Error('Vídeo vazio');

            await new Promise((resolve, reject) => {
                let to = setTimeout(() => reject(new Error('ffmpeg timeout 30s')), 30000);
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
                    .on('end', () => { clearTimeout(to); resolve(); })
                    .on('error', (e) => { clearTimeout(to); reject(e); })
                    .save(outputPath);
            });

            let outStat; try { outStat = fs.statSync(outputPath); } catch (_) { throw new Error('Vídeo gerou WebP vazio/inválido'); }
            if (outStat.size < 512) {
                try { fs.unlinkSync(outputPath); } catch (_) {}
                throw new Error('Vídeo gerou WebP vazio/inválido');
            }
            let header; try { header = fs.readFileSync(outputPath).slice(0, 12); } catch (_) { throw new Error('Vídeo gerou arquivo não-WebP'); }
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
                    let to = setTimeout(() => reject(new Error('ffmpeg fallback timeout 30s')), 30000);
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
                        .on('end', () => { clearTimeout(to); resolve(); })
                        .on('error', (e) => { clearTimeout(to); reject(e); })
                        .save(firstFrameWebp);
                });
                let fbOk = false; try { fbOk = fs.existsSync(firstFrameWebp) && fs.statSync(firstFrameWebp).size >= 64; } catch (_) {}
                if (fbOk) {
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

async function convertAnimatedWebpDirect(inputPath, outputPath) {
    await new Promise((resolve, reject) => {
        let to = setTimeout(() => reject(new Error('ffmpeg stickerToMedia timeout 30s')), 30000);
        ffmpeg(inputPath)
            .outputOptions(['-pix_fmt yuv420p', '-c:v libx264', '-crf 18', '-preset slow', '-movflags +faststart', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'])
            .toFormat('mp4')
            .on('end', () => { clearTimeout(to); resolve(); })
            .on('error', (e) => { clearTimeout(to); reject(e); })
            .save(outputPath);
    });
}

async function convertAnimatedWebpFrames(buffer, outputPath) {
    const tempId = crypto.randomBytes(4).toString('hex');
    const frameDir = path.join(tempDir, `stk_frames_${tempId}`);
    const written = [];
    try {
        fs.mkdirSync(frameDir, { recursive: true });
        const img = new Image();
        await img.load(buffer);
        if (!img.frames || !img.frames.length) throw new Error('WebP animado sem frames');
        const bufs = await img.demux({ buffers: true });
        if (!bufs.length) throw new Error('WebP animado sem frames');
        const delays = img.frames.map(f => f.delay || 100);
        const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
        const fps = Math.min(30, Math.max(1, Math.round(1000 / avgDelay)));
        for (let i = 0; i < bufs.length; i++) {
            const p = path.join(frameDir, `f_${i}.webp`);
            fs.writeFileSync(p, bufs[i]);
            written.push(p);
        }
        await new Promise((resolve, reject) => {
            let to = setTimeout(() => reject(new Error('ffmpeg fallback timeout 30s')), 30000);
            ffmpeg(path.join(frameDir, 'f_%d.webp'))
                .inputOptions(['-framerate', String(fps)])
                .outputOptions(['-pix_fmt yuv420p', '-c:v libx264', '-crf 18', '-preset slow', '-movflags +faststart', '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'])
                .toFormat('mp4')
                .on('end', () => { clearTimeout(to); resolve(); })
                .on('error', (e) => { clearTimeout(to); reject(e); })
                .save(outputPath);
        });
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) throw new Error('Vídeo gerado vazio');
    } finally {
        written.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
        try { fs.rmdirSync(frameDir); } catch (_) {}
    }
}

async function stickerToMedia(buffer, isAnimated = false) {
    if (!buffer || buffer.length > 10 * 1024 * 1024) throw new Error('Sticker muito grande');
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `stk_in_${tempId}.webp`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.${isAnimated ? 'mp4' : 'png'}`);
    try {
        fs.writeFileSync(inputPath, buffer);
        if (isAnimated) {
            try {
                await convertAnimatedWebpDirect(inputPath, outputPath);
            } catch (_) {
                await convertAnimatedWebpFrames(buffer, outputPath);
            }
        } else {
            await new Promise((resolve, reject) => {
                let to = setTimeout(() => reject(new Error('ffmpeg stickerToMedia timeout 30s')), 30000);
                ffmpeg(inputPath)
                    .outputOptions(['-vcodec png', '-compression_level 0', '-f image2'])
                    .on('end', () => { clearTimeout(to); resolve(); })
                    .on('error', (e) => { clearTimeout(to); reject(e); })
                    .save(outputPath);
            });
        }
        let outBuf; try { outBuf = fs.readFileSync(outputPath); } catch (_) { throw new Error('Falha conversão sticker'); }
        return { buffer: outBuf, mime: isAnimated ? 'video/mp4' : 'image/png', ext: isAnimated ? 'mp4' : 'png' };
    } catch (err) {
        console.error('❌ [FFMPEG] Falha:', err.message);
        throw err;
    } finally {
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
    }
}

async function changeSpeed(buffer, mimeType, speed = 1.0, voiceEffects = true) {
    if (!buffer || buffer.length > 20 * 1024 * 1024) throw new Error('Mídia muito grande');
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) throw new Error('Speed inválido');
    const isVideo = mimeType.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `speed_in_${tempId}${isVideo ? '.mp4' : '.ogg'}`);
    const outputPath = path.join(tempDir, `speed_out_${tempId}${isVideo ? '.mp4' : '.opus'}`);
    try {
        fs.writeFileSync(inputPath, buffer);
        await new Promise((resolve, reject) => {
            let to = setTimeout(() => reject(new Error('ffmpeg changeSpeed timeout 30s')), 30000);
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
            ff.on('end', () => { clearTimeout(to); resolve(); }).on('error', (e) => { clearTimeout(to); reject(e); }).save(outputPath);
        });
        let out; try { out = fs.readFileSync(outputPath); } catch (_) { throw new Error('Falha changeSpeed'); }
        return out;
    } catch (e) {
        console.error('❌ [SPEED] Falha:', e.message);
        throw e;
    } finally {
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
    }
}

async function convertAnimatedWebpToGifDirect(inputPath, outputPath) {
    await new Promise((resolve, reject) => {
        let to = setTimeout(() => reject(new Error('ffmpeg toGif timeout 30s')), 30000);
        ffmpeg(inputPath)
            .outputOptions([
                '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
                '-loop', '0'
            ])
            .toFormat('gif')
            .on('end', () => { clearTimeout(to); resolve(); })
            .on('error', (e) => { clearTimeout(to); reject(e); })
            .save(outputPath);
    });
}

async function convertAnimatedWebpFramesGif(buffer, outputPath) {
    const tempId = crypto.randomBytes(4).toString('hex');
    const frameDir = path.join(tempDir, `gif_frames_${tempId}`);
    const written = [];
    try {
        fs.mkdirSync(frameDir, { recursive: true });
        const img = new Image();
        await img.load(buffer);
        if (!img.frames || !img.frames.length) throw new Error('WebP animado sem frames');
        const bufs = await img.demux({ buffers: true });
        if (!bufs.length) throw new Error('WebP animado sem frames');
        const delays = img.frames.map(f => f.delay || 100);
        const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
        const fps = Math.min(30, Math.max(1, Math.round(1000 / avgDelay)));
        for (let i = 0; i < bufs.length; i++) {
            const p = path.join(frameDir, `f_${i}.webp`);
            fs.writeFileSync(p, bufs[i]);
            written.push(p);
        }
        await new Promise((resolve, reject) => {
            let to = setTimeout(() => reject(new Error('ffmpeg fallback timeout 30s')), 30000);
            ffmpeg(path.join(frameDir, 'f_%d.webp'))
                .inputOptions(['-framerate', String(fps)])
                .outputOptions([
                    '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
                    '-loop', '0'
                ])
                .toFormat('gif')
                .on('end', () => { clearTimeout(to); resolve(); })
                .on('error', (e) => { clearTimeout(to); reject(e); })
                .save(outputPath);
        });
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) throw new Error('GIF gerado vazio');
    } finally {
        written.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
        try { fs.rmdirSync(frameDir); } catch (_) {}
    }
}

async function mediaToGif(buffer, mimeType) {
    if (!buffer || buffer.length > 20 * 1024 * 1024) throw new Error('Mídia muito grande');
    const isSticker = (mimeType || '').toLowerCase().includes('sticker');
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `gif_in_${tempId}${isSticker ? '.webp' : '.mp4'}`);
    const outputPath = path.join(tempDir, `gif_out_${tempId}.gif`);
    try {
        fs.writeFileSync(inputPath, buffer);
        if (isSticker) {
            try {
                await convertAnimatedWebpToGifDirect(inputPath, outputPath);
            } catch (_) {
                await convertAnimatedWebpFramesGif(buffer, outputPath);
            }
        } else {
            await new Promise((resolve, reject) => {
                let to = setTimeout(() => reject(new Error('ffmpeg toGif timeout 30s')), 30000);
                ffmpeg(inputPath)
                    .outputOptions([
                        '-vf', 'fps=15,scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
                        '-loop', '0'
                    ])
                    .toFormat('gif')
                    .on('end', () => { clearTimeout(to); resolve(); })
                    .on('error', (e) => { clearTimeout(to); reject(e); })
                    .save(outputPath);
            });
        }
        let out; try { out = fs.readFileSync(outputPath); } catch (_) { throw new Error('Falha conversão GIF'); }
        if (out.length < 32) throw new Error('GIF gerado vazio');
        return out;
    } catch (e) {
        console.error('❌ [TOGIF] Falha:', e.message);
        throw e;
    } finally {
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {} });
    }
}

module.exports = {
    addMetadata,
    mediaToSticker,
    stickerToMedia,
    changeSpeed,
    mediaToGif
};
