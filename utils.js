const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { Jimp } = require('jimp');
const { Image } = require('node-webpmux');

const dbPath = path.join(__dirname, 'database.json');
const msgsPath = path.join(__dirname, 'messages.json');
const tempDir = path.join(process.cwd(), 'temp');

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// --- Database Management ---

function readDB() {
    try {
        if (!fs.existsSync(dbPath)) {
            const defaultDB = {
                config: {
                    botName: "BotSticker",
                    prefix: "!",
                    showLogoInMenu: true,
                    voiceEffects: true,
                    geminiModel: "gemini-1.5-flash",
                    summaryLimit: 20,
                    stickerPack: "BotStickerNode",
                    stickerAuthor: "Bot",
                    geminiApiKey: "AQ.Ab8RN6Jmde0aO8GI6R8Me_sxO4OO7DzECVb5l9Lyz0MCQ6sn6g"
                },
                stats: { restarts: 0, totalCommands: 0 },
                groups: { activeGroups: [] }
            };
            fs.writeFileSync(dbPath, JSON.stringify(defaultDB, null, 2));
            return defaultDB;
        }
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (error) {
        console.error('Erro ao ler database.json:', error);
        return {};
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Erro ao salvar database.json:', error);
    }
}

// --- Message Persistence ---

function saveMessage(jid, pushName, text) {
    if (!text) return;
    try {
        let msgs = {};
        if (fs.existsSync(msgsPath)) {
            msgs = JSON.parse(fs.readFileSync(msgsPath, 'utf8'));
        }
        
        // Cleanup: remove groups not in database
        const db = readDB();
        const activeGroups = db.groups.activeGroups;
        for (const id in msgs) {
            if (id.endsWith('@g.us') && !activeGroups.includes(id)) {
                delete msgs[id];
            }
        }

        if (!msgs[jid]) msgs[jid] = [];
        msgs[jid].push({ pushName, text, time: Date.now() });
        
        const limit = db.config.summaryLimit || 20;
        if (msgs[jid].length > limit) msgs[jid] = msgs[jid].slice(-limit);
        
        fs.writeFileSync(msgsPath, JSON.stringify(msgs, null, 2));
    } catch (e) {
        console.error('Erro ao salvar mensagem:', e);
    }
}

function getChatHistory(jid, limit = 20) {
    try {
        if (!fs.existsSync(msgsPath)) return [];
        const msgs = JSON.parse(fs.readFileSync(msgsPath, 'utf8'));
        return msgs[jid] ? msgs[jid].slice(-limit) : [];
    } catch (e) {
        return [];
    }
}

// --- Config Helpers ---
function readConfig() { return readDB().config; }
function writeConfig(newConfig) {
    const db = readDB();
    db.config = newConfig;
    writeDB(db);
}

// --- Stats Helpers ---
function readStats() { return readDB().stats; }
function incrementRestart() {
    const db = readDB();
    db.stats.restarts = (db.stats.restarts || 0) + 1;
    writeDB(db);
    return db.stats.restarts;
}
function incrementCommand() {
    const db = readDB();
    db.stats.totalCommands = (db.stats.totalCommands || 0) + 1;
    writeDB(db);
    return db.stats.totalCommands;
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

// --- Group Helpers ---
function isActiveGroup(jid) {
    const db = readDB();
    return db.groups.activeGroups.includes(jid);
}
function activateGroup(jid) {
    const db = readDB();
    if (!db.groups.activeGroups.includes(jid)) {
        db.groups.activeGroups.push(jid);
        writeDB(db);
        return true;
    }
    return false;
}
function deactivateGroup(jid) {
    const db = readDB();
    const index = db.groups.activeGroups.indexOf(jid);
    if (index !== -1) {
        db.groups.activeGroups.splice(index, 1);
        writeDB(db);
        return true;
    }
    return false;
}

// --- View Once & Media Helpers ---
function isViewOnce(message) {
    if (!message) return false;
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension) return true;
    const media = m.imageMessage || m.videoMessage || m.audioMessage;
    return !!(media && (media.viewOnce === true || media.viewOnce === 1));
}

function getMediaMessage(message) {
    if (!message) return null;
    let m = message;
    for (let i = 0; i < 5; i++) {
        if (m.ephemeralMessage) m = m.ephemeralMessage.message;
        else if (m.viewOnceMessage) m = m.viewOnceMessage.message;
        else if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
        else if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
        else if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
        else break;
    }
    if (m.imageMessage || m.videoMessage || m.stickerMessage || m.audioMessage || m.documentMessage) return m;
    if (m.url && (m.mimetype || m.fileLength)) return m;
    return null;
}

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
    const config = readConfig();
    const finalPack = pack || config.botName || 'Bot';
    const finalAuthor = author || `${config.botName} 🌌` || 'Bot';
    const isVideo = mimeType.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');
    let inputBuffer = buffer;
    if (!isVideo) {
        try {
            const image = await Jimp.read(buffer);
            image.resize({ w: 512, h: 512 });
            inputBuffer = await image.getBuffer('image/png');
        } catch (e) {}
    }
    const inputPath = path.join(tempDir, `stk_in_${tempId}${isVideo ? '.mp4' : '.png'}`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.webp`);
    try {
        fs.writeFileSync(inputPath, inputBuffer);
        await new Promise((resolve, reject) => {
            let ff = ffmpeg(inputPath);
            if (isVideo) ff = ff.inputOptions(['-t 6']).fps(12);
            ff.outputOptions(['-vcodec libwebp', '-vf scale=512:512,setsar=1', '-lossless 0', '-compression_level 5', '-q:v 60', '-loop 0', '-preset default', '-an']).toFormat('webp').on('end', resolve).on('error', reject).save(outputPath);
        });
        return await addMetadata(fs.readFileSync(outputPath), finalPack, finalAuthor);
    } catch (error) {
        console.error('❌ [CONVERSÃO] Falha:', error.message);
        throw error;
    } finally {
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(_) {} });
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
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(_) {} });
    }
}

async function changeSpeed(buffer, mimeType, speed = 1.0) {
    const config = readConfig();
    const isVideo = mimeType.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');
    const inputPath = path.join(tempDir, `speed_in_${tempId}${isVideo ? '.mp4' : '.ogg'}`);
    const outputPath = path.join(tempDir, `speed_out_${tempId}${isVideo ? '.mp4' : '.opus'}`);
    try {
        fs.writeFileSync(inputPath, buffer);
        await new Promise((resolve, reject) => {
            let ff = ffmpeg(inputPath);
            
            // Filtro de áudio (Pitch vs Velocidade Simples)
            let audioFilter = `atempo=${speed}`;
            if (config.voiceEffects) {
                // Efeito "Esquilo" (acelerado) ou "Voz Grossa" (desacelerado)
                // Aumentamos/diminuímos a taxa de amostragem e depois corrigimos a velocidade
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
                ]).toFormat('opus');
            }
            ff.on('end', resolve).on('error', reject).save(outputPath);
        });
        return fs.readFileSync(outputPath);
    } catch (e) {
        console.error('❌ [SPEED] Falha:', e.message);
        throw e;
    } finally {
        [inputPath, outputPath].forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(_) {} });
    }
}

module.exports = { 
    isActiveGroup, activateGroup, deactivateGroup, 
    isViewOnce, getMediaMessage, mediaToSticker, stickerToMedia, 
    readStats, incrementRestart, incrementCommand, formatUptime, 
    readConfig, writeConfig, saveMessage, getChatHistory,
    changeSpeed
};
