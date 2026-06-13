const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { exec } = require('child_process');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const crypto = require('crypto');
const ffmpegPathStatic = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');

// Tenta detectar FFmpeg no sistema primeiro, senão usa o estático do npm
let ffmpegPath = ffmpegPathStatic;
try {
    const systemFfmpeg = execSync('which ffmpeg').toString().trim();
    if (systemFfmpeg) {
        ffmpegPath = systemFfmpeg;
        console.log(`🎬 [SISTEMA] Usando FFmpeg do sistema: ${ffmpegPath}`);
    }
} catch (e) {
    console.log('🎬 [SISTEMA] FFmpeg não encontrado no sistema. Usando ffmpeg-static.');
}

// Configurar caminho do FFmpeg globalmente para fluent-ffmpeg
ffmpeg.setFfmpegPath(ffmpegPath);

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

/**
 * Verifies if the message container is a View Once message.
 */
function isViewOnce(message) {
    if (!message) return false;
    let m = message;
    
    // Desembrulha mensagens efêmeras se necessário
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    
    // Verifica wrappers explícitos de Visualização Única
    const hasWrapper = !!(m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension);
    if (hasWrapper) return true;
    
    // Verifica se a mídia interna tem a flag viewOnce (comum em mensagens citadas)
    const media = m.imageMessage || m.videoMessage || m.audioMessage;
    if (media && (media.viewOnce === true || media.viewOnce === 1)) return true;
    
    return false;
}

/**
 * Unwraps nested message wrappers (ephemeral, view-once, document-with-caption) 
 * to find the raw media message structure (imageMessage, videoMessage, etc.).
 */
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

/**
 * Converts an image or video buffer into a WhatsApp WebP sticker.
 */
async function mediaToSticker(buffer, mimeType) {
    try {
        let inputBuffer = buffer;
        
        if (mimeType.includes('video')) {
            const tempId = crypto.randomBytes(4).toString('hex');
            const inputPath = path.join(tempDir, `vid_in_${tempId}.mp4`);
            const outputPath = path.join(tempDir, `vid_out_${tempId}.webp`);

            fs.writeFileSync(inputPath, buffer);

            console.log(`🎬 [FFMPEG] Pré-processando vídeo para sticker (Limite 7s)...`);

            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .inputOptions(['-probesize 500M', '-analyzeduration 500M'])
                    .outputOptions([
                        '-vcodec libwebp',
                        '-vf scale=512:512:force_original_aspect_ratio=increase,fps=15,crop=512:512',
                        '-lossless 0',
                        '-compression_level 6',
                        '-q:v 50',
                        '-loop 0',
                        '-preset default',
                        '-an',
                        '-vsync 0',
                        '-t 7' // Limita a 7 segundos para figurinhas
                    ])
                    .toFormat('webp')
                    .on('end', () => resolve())
                    .save(outputPath);
            });

            inputBuffer = fs.readFileSync(outputPath);

            try { fs.unlinkSync(inputPath); } catch(_) {}
            try { fs.unlinkSync(outputPath); } catch(_) {}
        }
        const type = StickerTypes.CROPPED; 
        const sticker = new Sticker(inputBuffer, {
            pack: 'Antigravity Bot 🌌',
            author: 'Antigravity Bot',
            type: type,
            quality: 100 
        });
        return await sticker.toBuffer();
    } catch (error) {
        console.error('Erro ao converter para figurinha:', error);
        throw error;
    }
}

/**
 * Converts a sticker (WebP) back to regular media (PNG for static, MP4 for animated).
 */
async function stickerToMedia(buffer, isAnimated = false) {
    if (!isAnimated) {
        try {
            const pngBuffer = await sharp(buffer).png().toBuffer();
            return { buffer: pngBuffer, mime: 'image/png', ext: 'png' };
        } catch (error) {
            console.error('Erro ao converter figurinha estática para imagem:', error);
            throw error;
        }
    } else {
        const tempId = crypto.randomBytes(4).toString('hex');
        const inputPath = path.join(tempDir, `stk_in_${tempId}.webp`);
        const outputPath = path.join(tempDir, `stk_out_${tempId}.mp4`);

        fs.writeFileSync(inputPath, buffer);

        console.log(`🔄 [FFMPEG] Convertendo figurinha animada para MP4...`);

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .inputOptions(['-probesize 50M', '-analyzeduration 50M'])
                .outputOptions([
                    '-pix_fmt yuv420p',
                    '-c:v libx264',
                    '-crf 18',
                    '-preset slow',
                    '-movflags +faststart'
                ])
                .toFormat('mp4')
                .on('error', (err) => {
                    console.error('❌ [FFMPEG] Erro ao converter sticker animado:', err);
                    try { fs.unlinkSync(inputPath); } catch(_) {}
                    try { fs.unlinkSync(outputPath); } catch(_) {}
                    reject(err);
                })
                .on('end', () => {
                    try {
                        const outBuffer = fs.readFileSync(outputPath);
                        try { fs.unlinkSync(inputPath); } catch(_) {}
                        try { fs.unlinkSync(outputPath); } catch(_) {}
                        resolve({ buffer: outBuffer, mime: 'video/mp4', ext: 'mp4' });
                    } catch (err) {
                        try { fs.unlinkSync(inputPath); } catch(_) {}
                        try { fs.unlinkSync(outputPath); } catch(_) {}
                        reject(err);
                    }
                })
                .save(outputPath);
        });
    }
}

module.exports = {
    isActiveGroup,
    activateGroup,
    deactivateGroup,
    isViewOnce,
    getMediaMessage,
    mediaToSticker,
    stickerToMedia,
    readStats,
    incrementRestart,
    incrementCommand,
    formatUptime
};
