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

function _killFfmpeg(cmd) {
    try { if (cmd && typeof cmd.kill === 'function') cmd.kill('SIGKILL'); } catch (_) {}
}

async function shrinkImageBuffer(buffer, tempId) {
    const inputPath = path.join(tempDir, `stk_shrink_in_${tempId}.bin`);
    const outputPath = path.join(tempDir, `stk_shrink_out_${tempId}.jpg`);
    fs.writeFileSync(inputPath, buffer);
    try {
        await new Promise((resolve, reject) => {
            let cmd = null;
            const to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg timeout 60s')); }, 60000);
            cmd = ffmpeg(inputPath)
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
            console.log(`[STICKER-LOG] Jimp original ${origW}x${origH} aspect=${(origW/origH).toFixed(3)} mime=${mime} input=${buffer.length}B`);
            if (origW > 3000 || origH > 3000) {
                console.error(`❌ [STICKER-IMG] Rejeitado: dimensões ${origW}x${origH} excedem limite 3000`);
                throw new Error('Imagem muito grande');
            }
            // Detecta alfa real (varre bitmap) — se não tem transparência, pode usar cwebp mais simples
            let hasAlpha = false;
            try {
                const data = image.bitmap.data;
                for (let i = 3; i < data.length; i += 4) { if (data[i] < 255) { hasAlpha = true; break; } }
            } catch (_) {}
            console.log(`[STICKER-LOG] Jimp hasAlpha=${hasAlpha} origPixels=${origW*origH}`);

            // Preserva aspect ratio: só escala se lado maior > 512, sem esticar, sem upscale
            const MAX_SIDE = 512;
            if (origW > MAX_SIDE || origH > MAX_SIDE) {
                image.scaleToFit({ w: MAX_SIDE, h: MAX_SIDE });
                console.log(`[STICKER-LOG] Jimp após scaleToFit ${image.bitmap.width}x${image.bitmap.height} (aspect preservado, MAX=${MAX_SIDE})`);
            } else {
                console.log(`[STICKER-LOG] Jimp mantém original ${image.bitmap.width}x${image.bitmap.height} (abaixo de MAX, sem redimensionar)`);
            }
            // Garantir que imagem tenha alfa correto (RGBA) — evita granulado em bordas quando hasAlpha
            if (hasAlpha) image.rgba(true);
            const pngBuffer = await image.getBuffer('image/png');
            console.log(`[STICKER-LOG] PNG temporario ${pngBuffer.length} bytes (${(pngBuffer.length/1024).toFixed(1)}KB) hasAlpha=${hasAlpha} -> cwebp q85`);
            fs.writeFileSync(inputPath, pngBuffer);

            // Inteligente: escolhe sequência baseada no tamanho/complexidade
            // - PNG pequeno (<150KB) e sem alfa → tenta q85 direto (qualidade máxima)
            // - PNG grande ou com alfa → começa com q85 mas se estourar 950KB cai progressivamente
            // - Se Jimp gerou PNG >800KB (imagem detalhada), já pula primeiro alpha lossless pesado
            let imgAttempts;
            if (!hasAlpha && pngBuffer.length < 300 * 1024) {
                imgAttempts = [
                    "-q 85 -m 4 -mt -sharp_yuv",
                    "-q 80 -m 4 -mt",
                    "-q 75 -m 4 -mt",
                    "-q 70"
                ];
                console.log(`[STICKER-LOG] Estratégia: sem alfa e PNG leve → q85 simples`);
            } else if (pngBuffer.length > 600 * 1024) {
                imgAttempts = [
                    "-q 80 -alpha_q 90 -m 4 -mt",
                    "-q 75 -m 4 -mt",
                    "-q 70",
                    "-q 60"
                ];
                console.log(`[STICKER-LOG] Estratégia: PNG pesado ${pngBuffer.length}B → começa em q80 para evitar estouro`);
            } else {
                imgAttempts = [
                    "-q 85 -alpha_q 100 -m 4 -mt -sharp_yuv -alpha_filter best",
                    "-q 85 -alpha_q 100 -m 4 -mt",
                    "-q 80 -alpha_q 90 -m 4 -mt",
                    "-q 75 -m 4 -mt",
                    "-q 70"
                ];
                console.log(`[STICKER-LOG] Estratégia: padrão q85 alfa100`);
            }

            let imgOk = false;
            let lastImgErr = null;
            for (let i = 0; i < imgAttempts.length; i++) {
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
                console.log(`[STICKER-LOG] tentativa imagem ${i+1}/${imgAttempts.length}: ${imgAttempts[i]} | png=${pngBuffer.length}B orig=${origW}x${origH} hasAlpha=${hasAlpha}`);
                try {
                    await webp.cwebp(inputPath, outputPath, imgAttempts[i]);
                    const s = fs.statSync(outputPath);
                    console.log(`[STICKER-LOG] tentativa ${i+1} gerou ${s.size}B header=${fs.readFileSync(outputPath).slice(0,4).toString()} hex=${fs.readFileSync(outputPath).slice(0,16).toString('hex').slice(0,32)}`);
                    if (s.size < 64) throw new Error('WebP vazio (<64B)');
                    if (s.size > 950 * 1024 && i < imgAttempts.length - 1) {
                        console.warn(`⚠️ [STICKER-IMG] tentativa ${i+1} ficou ${s.size}B >950KB (limite 1MB) — causa: PNG ${pngBuffer.length}B + q alto — reduzindo qualidade`);
                        continue;
                    }
                    console.log(`[STICKER-LOG] tentativa imagem ${i+1} OK ${s.size}B (${(s.size/1024).toFixed(1)}KB)`);
                    imgOk = true;
                    break;
                } catch (e) {
                    lastImgErr = e;
                    console.warn(`⚠️ [STICKER-IMG] tentativa ${i+1} FALHOU | cmd="${imgAttempts[i]}" | motivo="${e.message}" | stack="${e.stack?.split('\n')[1]?.trim() || ''}" | png=${pngBuffer.length} orig=${origW}x${origH}`);
                }
            }
            if (!imgOk) {
                console.error(`❌ [STICKER-IMG] Todas ${imgAttempts.length} tentativas falharam | tempId=${tempId} | orig=${origW}x${origH} hasAlpha=${hasAlpha} png=${pngBuffer.length} mime=${mime} | último erro="${lastImgErr?.message}"`);
                throw lastImgErr || new Error('Falha cwebp após todas tentativas');
            }
            try { const s = fs.statSync(outputPath); console.log(`[STICKER-LOG] WebP gerado ${s.size} bytes (${(s.size/1024).toFixed(1)}KB) header=${fs.readFileSync(outputPath).slice(0,4).toString()} `); } catch(_){}
        } else {
            fs.writeFileSync(inputPath, buffer);
            let stats; try { stats = fs.statSync(inputPath); } catch (_) { throw new Error('Vídeo vazio'); }
            if (!stats.size) throw new Error('Vídeo vazio');

            // Tentativas proativas: reduz tempo/fps/qualidade até caber em <1MB e ffmpeg não falhar
            const videoAttempts = [
                { t: 6, fps: 10, q: 78, preset: 'default' },
                { t: 4, fps: 10, q: 72, preset: 'default' },
                { t: 3, fps: 8,  q: 65, preset: 'default' },
                { t: 2, fps: 8,  q: 55, preset: 'default' }
            ];
            let attemptOk = false;
            let lastVidErr = null;
            for (let i = 0; i < videoAttempts.length; i++) {
                const a = videoAttempts[i];
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
                console.log(`[STICKER-LOG] tentativa video ${i+1}/${videoAttempts.length}: t=${a.t}s fps=${a.fps} q=${a.q}`);
                try {
                    await new Promise((resolve, reject) => {
                        let cmd = null;
                        let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg timeout 30s')); }, 30000);
                        cmd = ffmpeg(inputPath)
                            .inputOptions([`-t ${a.t}`])
                            .outputOptions([
                                '-vf', `scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=${a.fps},setsar=1`,
                                '-c:v', 'libwebp',
                                '-lossless', '0',
                                '-q:v', String(a.q),
                                '-preset', a.preset,
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
                    if (outStat.size < 512) throw new Error('Vídeo gerou WebP vazio/inválido');
                    let header; try { header = fs.readFileSync(outputPath).slice(0, 12); } catch (_) { throw new Error('Vídeo gerou arquivo não-WebP'); }
                    if (header.slice(0, 4).toString() !== 'RIFF' || header.slice(8, 12).toString() !== 'WEBP') throw new Error('Vídeo gerou arquivo não-WebP');
                    // Se passou de 900KB, tenta próxima tentativa mais leve (evita estourar 1MB após exif)
                    if (outStat.size > 950 * 1024 && i < videoAttempts.length - 1) {
                        console.log(`[STICKER-LOG] tentativa ${i+1} ficou ${outStat.size} bytes >950KB — tentando menor qualidade/duração`);
                        continue;
                    }
                    console.log(`[STICKER-LOG] tentativa ${i+1} OK ${outStat.size} bytes`);
                    attemptOk = true;
                    break;
                } catch (e) {
                    lastVidErr = e;
                    console.warn(`⚠️ [STICKER] tentativa ${i+1} falhou: ${e.message} — tentando próxima redução`);
                }
            }
            if (!attemptOk) throw lastVidErr || new Error('Vídeo gerou WebP vazio/inválido após todas tentativas');
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
            console.log(`[STICKER-LOG] Header final RIFF=${result.slice(0,4).toString()} WEBP=${result.slice(8,12).toString()} | aspect preservado, q85 alfa100, original ${rawWebp.length} -> final ${result.length}`);
        } catch(e) {
            console.log(`[STICKER-LOG] ===== !s FIM (probe falhou) ===== final ${result.length} bytes dur=${Date.now()-startTs}ms err=${e.message}`);
        }
        return result;
    } catch (error) {
        console.error(`❌ [CONVERSÃO] Falha geral tempId=${tempId} isVideo=${isVideo} mime=${mime} input=${buffer?.length || 0}B | motivo="${error.message}" | stack="${error.stack?.split('\n')[1]?.trim() || ''}"`);
        if (isVideo && fs.existsSync(inputPath)) {
            const firstFrameWebp = path.join(tempDir, `stk_fb_${tempId}.webp`);
            cleanup.push(firstFrameWebp);
            try {
                await new Promise((resolve, reject) => {
                    let cmd = null;
                    let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg fallback timeout 30s')); }, 30000);
                    cmd = ffmpeg(inputPath)
                        .outputOptions([
                            '-vframes', '1',
                            '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1',
                            '-c:v', 'libwebp',
                            '-lossless', '0',
                            '-q:v', '75',
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
        let cmd = null;
        let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg stickerToMedia timeout 30s')); }, 30000);
        cmd = ffmpeg(inputPath)
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
            let cmd = null;
            let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg fallback timeout 30s')); }, 30000);
            cmd = ffmpeg(path.join(frameDir, 'f_%d.webp'))
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
    // auto-corrige flag isAnimated (Baileys/sticker-maker as vezes envia false pra animado)
    let effectiveAnimated = !!isAnimated;
    try {
        if (!effectiveAnimated && buffer && buffer.includes(Buffer.from('ANIM'))) effectiveAnimated = true;
    } catch (_) {}
    if (effectiveAnimated !== !!isAnimated) {
        console.log(`[STICKER-LOG] isAnimated corrigido: ${isAnimated} -> ${effectiveAnimated} (detectado ANIM chunk)`);
        isAnimated = effectiveAnimated;
    }
    console.log(`\n[STICKER-LOG] ===== !toimg INICIO ===== isAnimated=${isAnimated} (orig=${!!effectiveAnimated}) inputBytes=${buffer?.length || 0} (${buffer? (buffer.length/1024).toFixed(1)+'KB':''}) header=${buffer?.slice(0,4).toString() || ''} WEBP=${buffer?.slice(8,12).toString() || ''}`);
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
            // NÃO aplicar filtros de escala — extrai dimensões nativas do VP8/WebP sem esticar para 512x512
            await new Promise((resolve, reject) => {
                let cmd = null;
                let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg stickerToMedia timeout 30s')); }, 30000);
                cmd = ffmpeg(inputPath)
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
            console.log(`[STICKER-LOG] ===== !toimg FIM ===== dur=${Date.now()-startTs2}ms | extração preserva dimensões nativas do WebP (aspect preservado)`);
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
            let cmd = null;
            let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg changeSpeed timeout 30s')); }, 30000);
            let ff = ffmpeg(inputPath);
            cmd = ff;
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
        let cmd = null;
        let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg toGif timeout 30s')); }, 30000);
        cmd = ffmpeg(inputPath)
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
            let cmd = null;
            let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg fallback timeout 30s')); }, 30000);
            cmd = ffmpeg(path.join(frameDir, 'f_%d.webp'))
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
                let cmd = null;
                let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg toGif timeout 30s')); }, 30000);
                cmd = ffmpeg(inputPath)
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
                    let cmd = null;
                    let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg gifVideo timeout 30s')); }, 30000);
                    cmd = ffmpeg(inputPath)
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
                let cmd = null;
                let to = setTimeout(() => { _killFfmpeg(cmd); reject(new Error('ffmpeg gifVideo timeout 30s')); }, 30000);
                cmd = ffmpeg(inputPath)
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
