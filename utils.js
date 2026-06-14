const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { Jimp } = require('jimp');
const { Image } = require('node-webpmux');
const webp = require('webp-converter');

// Configuração de metadados padrão
const STICKER_PACK = 'BotStickerNode';
const STICKER_AUTHOR = 'Antigravity';

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
    
    // Verifica wrappers explícitos
    if (m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension) return true;
    
    // Verifica flag dentro da mídia
    const media = m.imageMessage || m.videoMessage || m.audioMessage;
    if (media && (media.viewOnce === true || media.viewOnce === 1)) return true;
    
    return false;
}

function getMediaMessage(message) {
    if (!message) return null;
    let m = message;
    
    // Desenrola wrappers sucessivamente (Recursivo simples)
    let found = false;
    for (let i = 0; i < 5; i++) { // Limite de 5 níveis de profundidade
        if (m.ephemeralMessage) m = m.ephemeralMessage.message;
        else if (m.viewOnceMessage) m = m.viewOnceMessage.message;
        else if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
        else if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
        else if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
        else {
            found = true;
            break;
        }
    }

    // Retorna o nó que contém a mídia real
    if (m.imageMessage || m.videoMessage || m.stickerMessage || m.audioMessage || m.documentMessage) {
        return m;
    }
    
    // Fallback para mensagens que já são o nó da mídia
    if (m.url && (m.mimetype || m.fileLength)) {
        return m;
    }

    return null;
}

async function addMetadata(buffer, pack, author) {
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `meta_in_${tempId}.webp`);
    const exifPath = path.join(tempDir, `meta_${tempId}.exif`);
    const outputPath = path.join(tempDir, `meta_out_${tempId}.webp`);

    try {
        fs.writeFileSync(inputPath, buffer);
        
        const json = {
            "sticker-pack-id": `bot-${tempId}`,
            "sticker-pack-name": pack,
            "sticker-pack-publisher": author,
            "emojis": ["✅"]
        };

        const jsonBuffer = Buffer.from(JSON.stringify(json), "utf-8");
        const exifHeader = Buffer.from([
            0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 
            0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 
            0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
        ]);
        const exifBuffer = Buffer.concat([exifHeader, jsonBuffer]);
        exifBuffer.writeUInt32LE(jsonBuffer.length, 14);
        fs.writeFileSync(exifPath, exifBuffer);

        console.log('🎬 [WEBPMUX] Adicionando metadados via binário oficial...');
        // webpmux_add retorna uma promessa que precisamos aguardar
        await webp.webpmux_add(inputPath, outputPath, exifPath, 'exif');
        
        if (fs.existsSync(outputPath)) {
            return fs.readFileSync(outputPath);
        } else {
            throw new Error('Arquivo de saída do webpmux não foi gerado.');
        }
    } catch (e) {
        console.error('❌ [METADATA] Falha no Webpmux:', e.message);
        return buffer;
    } finally {
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch(_) {}
        try { if (fs.existsSync(exifPath)) fs.unlinkSync(exifPath); } catch(_) {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(_) {}
    }
}

// --- Media & Sticker Conversion Functions ---

async function mediaToSticker(buffer, mimeType, pack = STICKER_PACK, author = STICKER_AUTHOR) {
    const isVideo = mimeType.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');
    let inputBuffer = buffer;

    if (!isVideo) {
        try {
            const image = await Jimp.read(buffer);
            image.resize({ w: 512, h: 512 });
            inputBuffer = await image.getBuffer('image/png');
        } catch (e) {
            console.error('❌ [JIMP] Erro:', e.message);
        }
    }

    const inputExt = isVideo ? '.mp4' : '.png';
    const inputPath = path.join(tempDir, `stk_in_${tempId}${inputExt}`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.webp`);

    try {
        fs.writeFileSync(inputPath, inputBuffer);

        await new Promise((resolve, reject) => {
            let ff = ffmpeg(inputPath);
            if (isVideo) {
                // Otimizado para figurinhas animadas (WhatsApp é rigoroso com tamanho/fps)
                ff = ff.inputOptions(['-t 6']).fps(12);
            }

            ff.outputOptions([
                '-vcodec libwebp',
                '-vf scale=512:512,setsar=1',
                '-lossless 0',
                '-compression_level 5',
                '-q:v 60',
                '-loop 0',
                '-preset default',
                '-an'
            ])
            .toFormat('webp')
            .on('end', resolve)
            .on('error', reject)
            .save(outputPath);
        });

        const webpBuffer = fs.readFileSync(outputPath);
        return await addMetadata(webpBuffer, pack, author);
    } catch (error) {
        console.error('❌ [CONVERSÃO] Falha:', error.message);
        throw error;
    } finally {
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch(_) {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(_) {}
    }
}

async function stickerToMedia(buffer, isAnimated = false) {
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `stk_in_${tempId}.webp`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.${isAnimated ? 'mp4' : 'png'}`);

    try {
        fs.writeFileSync(inputPath, buffer);
        console.log(`🔄 [FFMPEG] Convertendo figurinha para ${isAnimated ? 'vídeo' : 'imagem'} (Alta Resolução)...`);

        await new Promise((resolve, reject) => {
            let ff = ffmpeg(inputPath);

            if (isAnimated) {
                ff.outputOptions([
                    '-pix_fmt yuv420p',
                    '-c:v libx264',
                    '-crf 18', // Qualidade superior (menor é melhor)
                    '-preset slow',
                    '-movflags +faststart',
                    '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2' // Mantém original, apenas garante par para H264
                ]).toFormat('mp4');
            } else {
                ff.outputOptions([
                    '-vcodec png',
                    '-compression_level 0', // Sem compressão para manter qualidade máxima
                    '-f image2'
                ]);
            }

            ff.on('end', resolve)
              .on('error', reject)
              .save(outputPath);
        });

        const outBuffer = fs.readFileSync(outputPath);
        return { 
            buffer: outBuffer, 
            mime: isAnimated ? 'video/mp4' : 'image/png', 
            ext: isAnimated ? 'mp4' : 'png' 
        };
    } catch (err) {
        console.error('❌ [FFMPEG] Falha na conversão de sticker:', err.message);
        throw new Error(`Erro ao converter figurinha ${isAnimated ? 'animada' : 'estática'}.`);
    } finally {
        try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch(_) {}
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch(_) {}
    }
}

module.exports = {
    isActiveGroup, activateGroup, deactivateGroup,
    isViewOnce, getMediaMessage, mediaToSticker, stickerToMedia,
    readStats, incrementRestart, incrementCommand, formatUptime
};
