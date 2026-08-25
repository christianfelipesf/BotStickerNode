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

const STICKER_IMG_MAX = 10 * 1024 * 1024;
const STICKER_VIDEO_MAX = 50 * 1024 * 1024;

async function shrinkImageBuffer(buffer, tempId) {
    const inputPath = path.join(tempDir, `stk_shrink_in_${tempId}.bin`);
    const outputPath = path.join(tempDir, `stk_shrink_out_${tempId}.jpg`);
    fs.writeFileSync(inputPath, buffer);
    try {
        await new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error('ffmpeg timeout 60s')), 60000);
            ffmpeg(inputPath)
                .outputOptions(['-vf', "scale='min(1600,iw)':-2", '-q:v', '5'])
                .toFormat('mjpeg')
                .on('end', () => { clearTimeout(to); resolve(); })
                .on('error', (e) => { clearTimeout(to); reject(e); })
                .save(outputPath);
        });
        const out = fs.readFileSync(outputPath);
        if (out.length < 1024) throw new Error('compressão gerou arquivo vazio');
        return out;
    } finally {
        try { fs.unlinkSync(inputPath); } catch (_) {}
        try { fs.unlinkSync(outputPath); } catch (_) {}
    }
}

async function mediaToSticker(buffer, mimeType, pack, author) {
    const startTs = Date.now();
    if (!buffer || !buffer.length) throw new Error('Mídia vazia');
    const mime = (mimeType || '').toLowerCase();
    const isVideo = mime.includes('video');
    console.log(`\n[STICKER-LOG] ===== !s INICIO ===== tempId pending mime=${mime} isVideo=${isVideo} inputBytes=${buffer.length} (${(buffer.length/1024).toFixed(1)}KB)`);
    // tenta detectar dimensões originais sem Jimp para log rápido
    try {
        const probe = await Jimp.read(buffer).catch(()=>null);
        if (probe) console.log(`[STICKER-LOG] probe original ${probe.bitmap.width}x${probe.bitmap.height} mime=${mime}`);
    } catch(_) {}
    if (isVideo && buffer.length > STICKER_VIDEO_MAX) throw new Error('Mídia muito grande (max 50MB)');
    const tempId = crypto.randomBytes(4).toString('hex');
    console.log(`[STICKER-LOG] tempId=${tempId} pack="${pack}" author="${author}"`);
    if (!isVideo && buffer.length > STICKER_IMG_MAX) {
        console.log(`🖼️ [STICKER] imagem ${(buffer.length / 1048576).toFixed(1)}MB > 10MB — comprimindo antes de converter`);
        try {
            buffer = await shrinkImageBuffer(buffer, tempId);
        } catch (e) {
            console.error(`❌ [STICKER] compressão falhou: ${e.message}`);
            throw new Error('Mídia muito grande (max 10MB)');
        }
        if (buffer.length > STICKER_IMG_MAX) throw new Error('Mídia muito grande (max 10MB)');
    }
    const inputPath = path.join(tempDir, `stk_in_${tempId}${isVideo ? '.mp4' : '.png'}`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.webp`);
    const cleanup = [inputPath, outputPath];

    try {
        if (!isVideo) {
            const image = await Jimp.read(buffer);
            const origW = image.bitmap.width, origH = image.bitmap.height;
            console.log(`[STICKER-LOG] Jimp original ${origW}x${origH} aspect=${(origW/origH).toFixed(3)} -> resize 512x512 (ESTICA 1:1, destroi aspect)`);
            if (image.bitmap.width > 3000 || image.bitmap.height > 3000) throw new Error('Imagem muito grande');
            image.resize({ w: 512, h: 512 });
            console.log(`[STICKER-LOG] Jimp após resize ${image.bitmap.width}x${image.bitmap.height}`);
            const pngBuffer = await image.getBuffer('image/png');
            console.log(`[STICKER-LOG] PNG temporario ${pngBuffer.length} bytes -> cwebp -q 60`);
            fs.writeFileSync(inputPath, pngBuffer);
            await webp.cwebp(inputPath, outputPath, "-q 60");
            try { const s = fs.statSync(outputPath); console.log(`[STICKER-LOG] WebP gerado ${s.size} bytes (${(s.size/1024).toFixed(1)}KB) header=${fs.readFileSync(outputPath).slice(0,4).toString()} `); } catch(_){}
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

        const rawWebp = fs.readFileSync(outputPath);
        console.log(`[STICKER-LOG] raw WebP antes de addMetadata ${rawWebp.length} bytes`);
        // inspeciona chunks RIFF para ver se já tem EXIF
        try {
            const chk = rawWebp.slice(0, 100).toString('hex').slice(0,80);
            console.log(`[STICKER-LOG] raw WebP head hex=${chk}...`);
        } catch(_){}
        const result = await addMetadata(rawWebp, pack, author);
        if (!result || result.length < 512) {
            throw new Error('Falha ao injetar metadados do sticker');
        }
        // log detalhado do resultado
        try {
            const imgProbe = new Image(); await imgProbe.load(result);
            const exifLen = imgProbe.exif ? imgProbe.exif.length : 0;
            const exifPreview = imgProbe.exif ? imgProbe.exif.slice(0,120).toString('utf-8').replace(/\0/g,'.') : 'sem exif';
            console.log(`[STICKER-LOG] ===== !s FIM ===== tempId=${tempId} final ${result.length} bytes (${(result.length/1024).toFixed(1)}KB) exifLen=${exifLen} exifPreview="${exifPreview.slice(0,100)}" dur=${Date.now()-startTs}ms`);
            console.log(`[STICKER-LOG] Header final RIFF=${result.slice(0,4).toString()} WEBP=${result.slice(8,12).toString()} | esticado 512x512, original ${rawWebp.length} -> final ${result.length} | PERDA: original aspect destruido, q60 aplicado`);
        } catch(e) {
            console.log(`[STICKER-LOG] ===== !s FIM (probe falhou) ===== final ${result.length} bytes dur=${Date.now()-startTs}ms err=${e.message}`);
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
    const startTs2 = Date.now();
    console.log(`\n[STICKER-LOG] ===== !toimg INICIO ===== isAnimated=${isAnimated} inputBytes=${buffer?.length || 0} (${buffer? (buffer.length/1024).toFixed(1)+'KB':''}) header=${buffer?.slice(0,4).toString() || ''} WEBP=${buffer?.slice(8,12).toString() || ''}`);
    // tenta inspecionar EXIF/WebP chunks para ver se tem original embutido (como outros bots fazem)
    try {
        const probeImg = new Image(); await probeImg.load(buffer);
        const exifLen = probeImg.exif ? probeImg.exif.length : 0;
        const hasExif = !!probeImg.exif;
        let exifJson = null; let exifPreview='';
        if (hasExif) {
            try { exifPreview = probeImg.exif.slice(0,300).toString('utf-8').replace(/\0/g,'.').slice(0,200); } catch(_){}
            try { const raw = probeImg.exif.slice(22).toString('utf-8'); exifJson = JSON.parse(raw); } catch(_){ }
        }
        console.log(`[STICKER-LOG] probe WebP exifLen=${exifLen} hasExif=${hasExif} preview="${exifPreview}" jsonKeys=${exifJson? Object.keys(exifJson).join(','): 'n/a'}`);
        if (exifJson && exifJson.data) console.log(`[STICKER-LOG] ATENCAO: sticker contém data embutida len=${String(exifJson.data).length} (original embutido detectado!)`);
        // também loga RIFF chunks
        let off=12; let chunks=[];
        while(off+8 < buffer.length && chunks.length<6){ const id=buffer.slice(off,off+4).toString(); const sz=buffer.readUInt32LE(off+4); chunks.push(`${id}:${sz}`); off+=8+sz + (sz%2); }
        console.log(`[STICKER-LOG] RIFF chunks: ${chunks.join(' | ')}`);
        console.log(`[STICKER-LOG] Se for sticker do seu bot: exifLen deve ser ~150-200 bytes (só pack/author). Se for de outro bot com restauração perfeita, exifLen será >10KB e conterá JPEG base64.`);
    } catch(e){ console.log(`[STICKER-LOG] probe WebP falhou: ${e.message}`); }
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
        // log do resultado e tentativa de detectar dimensões reais
        try {
            if (!isAnimated) {
                const outImg = await Jimp.read(outBuf).catch(()=>null);
                if (outImg) console.log(`[STICKER-LOG] out PNG ${outImg.bitmap.width}x${outImg.bitmap.height} ${outBuf.length} bytes (${(outBuf.length/1024).toFixed(1)}KB)`);
                else console.log(`[STICKER-LOG] out PNG ${outBuf.length} bytes header=${outBuf.slice(0,8).toString('hex')}`);
            } else {
                console.log(`[STICKER-LOG] out MP4 ${outBuf.length} bytes header=${outBuf.slice(0,4).toString('hex')}`);
            }
            console.log(`[STICKER-LOG] ===== !toimg FIM ===== dur=${Date.now()-startTs2}ms | OBS: saida é sempre 512x512 (estica) pois original foi destruido no !s. Para restaurar 9:16 perfeito precisaria EXIF com original embutido.`);
        } catch(_){}
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

async function mediaToGifVideo(buffer, mimeType) {
    if (!buffer || buffer.length > 20 * 1024 * 1024) throw new Error('Mídia muito grande');
    const isSticker = (mimeType || '').toLowerCase().includes('sticker');
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `gifvid_in_${tempId}${isSticker ? '.webp' : '.mp4'}`);
    const outputPath = path.join(tempDir, `gifvid_out_${tempId}.mp4`);
    try {
        fs.writeFileSync(inputPath, buffer);
        if (isSticker) {
            try {
                await new Promise((resolve, reject) => {
                    let to = setTimeout(() => reject(new Error('ffmpeg gifVideo timeout 30s')), 30000);
                    ffmpeg(inputPath)
                        .outputOptions([
                            '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15,setsar=1',
                            '-c:v', 'libx264',
                            '-pix_fmt', 'yuv420p',
                            '-crf', '18',
                            '-preset', 'fast',
                            '-movflags', '+faststart',
                            '-an'
                        ])
                        .toFormat('mp4')
                        .on('end', () => { clearTimeout(to); resolve(); })
                        .on('error', (e) => { clearTimeout(to); reject(e); })
                        .save(outputPath);
                });
            } catch (_) {
                const { buffer: mp4Buffer } = await stickerToMedia(buffer, true);
                fs.writeFileSync(outputPath, mp4Buffer);
            }
        } else {
            await new Promise((resolve, reject) => {
                let to = setTimeout(() => reject(new Error('ffmpeg gifVideo timeout 30s')), 30000);
                ffmpeg(inputPath)
                    .outputOptions([
                        '-vf', 'fps=15,scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1',
                        '-c:v', 'libx264',
                        '-pix_fmt', 'yuv420p',
                        '-crf', '18',
                        '-preset', 'fast',
                        '-movflags', '+faststart',
                        '-an',
                        '-t', '6'
                    ])
                    .toFormat('mp4')
                    .on('end', () => { clearTimeout(to); resolve(); })
                    .on('error', (e) => { clearTimeout(to); reject(e); })
                    .save(outputPath);
            });
        }
        let out; try { out = fs.readFileSync(outputPath); } catch (_) { throw new Error('Falha conversão GIF video'); }
        if (!out || out.length < 512) throw new Error('GIF video gerado vazio');
        return out;
    } catch (e) {
        console.error('❌ [TOGIFVIDEO] Falha:', e.message);
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
    mediaToGif,
    mediaToGifVideo
};
