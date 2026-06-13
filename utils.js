const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { exec, execSync } = require('child_process');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');

const groupsFilePath = path.join(__dirname, 'groups.json');
const statsFilePath = path.join(__dirname, 'stats.json');
const tempDir = path.join(process.cwd(), 'temp');

// Garante que a pasta temp exista
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// --- Stats Management Functions ---

function readStats() {
    try {
        if (!fs.existsSync(statsFilePath)) {
            fs.writeFileSync(statsFilePath, JSON.stringify({ restarts: 0, totalCommands: 0 }, null, 2));
        }
        const data = fs.readFileSync(statsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Erro ao ler stats.json:', error);
        return { restarts: 0, totalCommands: 0 };
    }
}

function writeStats(data) {
    try {
        fs.writeFileSync(statsFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Erro ao salvar stats.json:', error);
    }
}

function incrementRestart() {
    const stats = readStats();
    stats.restarts = (stats.restarts || 0) + 1;
    writeStats(stats);
    return stats.restarts;
}

function incrementCommand() {
    const stats = readStats();
    stats.totalCommands = (stats.totalCommands || 0) + 1;
    writeStats(stats);
    return stats.totalCommands;
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);

    return parts.join(' ');
}

// --- Group Management Functions ---

function readGroups() {
    try {
        if (!fs.existsSync(groupsFilePath)) {
            fs.writeFileSync(groupsFilePath, JSON.stringify({ activeGroups: [] }, null, 2));
        }
        const data = fs.readFileSync(groupsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Erro ao ler groups.json:', error);
        return { activeGroups: [] };
    }
}

function writeGroups(data) {
    try {
        fs.writeFileSync(groupsFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Erro ao salvar groups.json:', error);
    }
}

function isActiveGroup(jid) {
    const data = readGroups();
    return data.activeGroups.includes(jid);
}

function activateGroup(jid) {
    const data = readGroups();
    if (!data.activeGroups.includes(jid)) {
        data.activeGroups.push(jid);
        writeGroups(data);
        return true;
    }
    return false;
}

function deactivateGroup(jid) {
    const data = readGroups();
    const index = data.activeGroups.indexOf(jid);
    if (index !== -1) {
        data.activeGroups.splice(index, 1);
        writeGroups(data);
        return true;
    }
    return false;
}

// --- View Once & Media Helper Functions ---

function isViewOnce(message) {
    if (!message) return false;
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    const hasWrapper = !!(m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension);
    if (hasWrapper) return true;
    const media = m.imageMessage || m.videoMessage || m.audioMessage;
    if (media && (media.viewOnce === true || media.viewOnce === 1)) return true;
    return false;
}

function getMediaMessage(message) {
    if (!message) return null;
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    if (m.imageMessage || m.videoMessage || m.stickerMessage || m.audioMessage || m.documentMessage) {
        return m;
    }
    return null;
}

// --- Media & Sticker Conversion Functions ---

async function mediaToSticker(buffer, mimeType) {
    try {
        let inputBuffer = buffer;
        if (mimeType.includes('video')) {
            const tempId = crypto.randomBytes(4).toString('hex');
            const inputPath = path.join(tempDir, `vid_in_${tempId}.mp4`);
            const outputPath = path.join(tempDir, `vid_out_${tempId}.webp`);

            fs.writeFileSync(inputPath, buffer);
            console.log(`🎬 [FFMPEG] Processando vídeo para sticker (${mimeType})...`);

            try {
                await new Promise((resolve, reject) => {
                    ffmpeg(inputPath)
                        .inputOptions(['-t 7'])
                        .outputOptions([
                            '-vcodec libwebp', // libwebp é geralmente mais compatível que libwebp_anim para stickers simples
                            '-vf scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0',
                            '-lossless 0',
                            '-compression_level 4',
                            '-q:v 50',
                            '-loop 0',
                            '-an'
                        ])
                        .toFormat('webp')
                        .on('start', (cmd) => console.log('🚀 [FFMPEG] Comando:', cmd))
                        .on('end', () => resolve())
                        .on('error', (err, stdout, stderr) => {
                            console.error('❌ [FFMPEG] Erro:', err.message);
                            console.error('❌ [FFMPEG] Stderr:', stderr);
                            reject(err);
                        })
                        .save(outputPath);
                });

                inputBuffer = fs.readFileSync(outputPath);
            } catch (ffmpegErr) {
                console.error('❌ [FFMPEG] Falha no processamento de vídeo:', ffmpegErr.message);
                throw new Error('Não foi possível processar o vídeo para figurinha.');
            } finally {
                try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch(_) {}
                try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(_) {}
            }
        }
        const sticker = new Sticker(inputBuffer, {
            pack: 'Antigravity Bot 🌌',
            author: 'Antigravity Bot',
            type: StickerTypes.FULL,
            quality: 80
        });
        return await sticker.toBuffer();
    } catch (error) {
        console.error('Erro ao converter para figurinha:', error);
        throw error;
    }
}

async function stickerToMedia(buffer, isAnimated = false) {
    if (!isAnimated) {
        try {
            return { buffer: await sharp(buffer).png().toBuffer(), mime: 'image/png', ext: 'png' };
        } catch (error) {
            console.error('Erro ao converter figurinha estática:', error);
            throw error;
        }
    } else {
        const tempId = crypto.randomBytes(4).toString('hex');
        const inputPathWebp = path.join(tempDir, `stk_in_${tempId}.webp`);
        const inputPathGif = path.join(tempDir, `stk_in_${tempId}.gif`);
        const outputPath = path.join(tempDir, `stk_out_${tempId}.mp4`);

        console.log(`🔄 [FFMPEG] Convertendo figurinha animada...`);

        try {
            // Tenta converter para GIF usando Sharp primeiro para contornar a limitação do FFmpeg (skipping ANIM chunk)
            try {
                const gifBuffer = await sharp(buffer, { animated: true }).gif().toBuffer();
                fs.writeFileSync(inputPathGif, gifBuffer);
                console.log('✅ [SHARP] Figurinha convertida para GIF para processamento.');
            } catch (sharpError) {
                console.warn('⚠️ [SHARP] Falha ao converter para GIF, tentando WebP direto:', sharpError.message);
                fs.writeFileSync(inputPathWebp, buffer);
            }

            const inputPath = fs.existsSync(inputPathGif) ? inputPathGif : inputPathWebp;

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .inputOptions([
                        '-probesize 100M', 
                        '-analyzeduration 100M'
                    ])
                    .outputOptions([
                        '-pix_fmt yuv420p',
                        '-c:v libx264',
                        '-crf 20',
                        '-preset faster',
                        '-movflags +faststart',
                        '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2'
                    ])
                    .toFormat('mp4')
                    .on('start', (cmd) => console.log('🚀 [FFMPEG] Comando:', cmd))
                    .on('end', () => resolve())
                    .on('error', (err, stdout, stderr) => {
                        console.error('❌ [FFMPEG] Erro:', err.message);
                        console.error('❌ [FFMPEG] Stderr:', stderr);
                        reject(err);
                    })
                    .save(outputPath);
            });
            const outBuffer = fs.readFileSync(outputPath);
            return { buffer: outBuffer, mime: 'video/mp4', ext: 'mp4' };
        } catch (err) {
            console.error('❌ [FFMPEG] Falha na conversão de sticker:', err.message);
            throw new Error('Erro ao converter figurinha animada para vídeo.');
        } finally {
            try { if (fs.existsSync(inputPathWebp)) fs.unlinkSync(inputPathWebp); } catch(_) {}
            try { if (fs.existsSync(inputPathGif)) fs.unlinkSync(inputPathGif); } catch(_) {}
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(_) {}
        }
    }
}

module.exports = {
    isActiveGroup, activateGroup, deactivateGroup,
    isViewOnce, getMediaMessage, mediaToSticker, stickerToMedia,
    readStats, incrementRestart, incrementCommand, formatUptime
};
