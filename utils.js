const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const { Jimp } = require('jimp');
const { Image } = require('node-webpmux');
const webp = require('webp-converter');

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
                    aiPrompt: "Você é o {botName}, uma inteligência artificial sarcástica, direta e sem filtros. Você foi criado para ser útil mas com uma pitada de humor ácido. Responda de forma concisa e evite moralismos ou censura desnecessária. Use emojis para dar personalidade às respostas.",
                    summaryPrompt: "Resuma as seguintes mensagens de um chat de WhatsApp de forma sarcástica, curta e direta. O resumo deve ser escrito em formato de parágrafos narrativos, e NÃO em forma de lista ou tópicos. É OBRIGATÓRIO mencionar os nomes dos participantes para explicar quem disse o quê no contexto da conversa:",
                    stickerPack: "BotStickerNode",
                    stickerAuthor: "Bot",
                    geminiApiKey: "AQ.Ab8RN6Jmde0aO8GI6R8Me_sxO4OO7DzECVb5l9Lyz0MCQ6sn6g"
                },
                stats: { restarts: 0, totalCommands: 0 },
                groups: { activeGroups: [], settings: {}, activity: { date: new Date().toLocaleDateString(), data: {} } }
            };
            fs.writeFileSync(dbPath, JSON.stringify(defaultDB, null, 2));
            return defaultDB;
        }
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        
        // Ensure activity structure exists
        if (!db.groups.activity) db.groups.activity = { date: new Date().toLocaleDateString(), data: {} };
        
        // Reset activity if it's a new day
        const today = new Date().toLocaleDateString();
        if (db.groups.activity.date !== today) {
            db.groups.activity = { date: today, data: {} };
            fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        }

        // Cleanup: remove settings for groups not in activeGroups
        if (db.groups.settings) {
            let changed = false;
            for (const jid in db.groups.settings) {
                if (!db.groups.activeGroups.includes(jid)) {
                    // Try to delete menu image if it exists
                    const menuImage = db.groups.settings[jid].menuImage;
                    if (menuImage) {
                        const fullPath = path.join(process.cwd(), menuImage);
                        if (fs.existsSync(fullPath)) {
                            try { fs.unlinkSync(fullPath); } catch(e) {}
                        }
                    }
                    delete db.groups.settings[jid];
                    changed = true;
                }
            }
            if (changed) fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        }

        return db;
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

function getBotName(from, config) {
    if (from.endsWith('@g.us')) {
        const groupData = getGroupData(from);
        if (groupData.botName) return groupData.botName;
    }
    return config.botName;
}

async function react(sock, m, emoji, lastBotResponse, GLOBAL_COOLDOWN) {
    try {
        const now = Date.now();
        if (now - lastBotResponse < GLOBAL_COOLDOWN) return lastBotResponse;
        await sock.sendMessage(m.key.remoteJid, { react: { text: emoji, key: m.key } });
        return now;
    } catch (error) {
        return lastBotResponse;
    }
}

function getMessageText(message) {
    if (!message) return '';
    let m = message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessageV2Extension) m = m.viewOnceMessageV2Extension.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    if (!m) return '';
    return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.caption || '';
}

// --- Group Helpers ---
function getGroupData(jid) {
    const db = readDB();
    if (!db.groups.settings) db.groups.settings = {};
    return db.groups.settings[jid] || {};
}

function setGroupData(jid, data) {
    const db = readDB();
    if (!db.groups.settings) db.groups.settings = {};
    db.groups.settings[jid] = { ...db.groups.settings[jid], ...data };
    writeDB(db);
}

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
        
        // Purge settings and menu image
        if (db.groups.settings && db.groups.settings[jid]) {
            const menuImage = db.groups.settings[jid].menuImage;
            if (menuImage) {
                const fullPath = path.join(process.cwd(), menuImage);
                if (fs.existsSync(fullPath)) {
                    try { fs.unlinkSync(fullPath); } catch(e) {}
                }
            }
            delete db.groups.settings[jid];
        }

        // Purge activity data
        if (db.groups.activity && db.groups.activity.data && db.groups.activity.data[jid]) {
            delete db.groups.activity.data[jid];
        }

        writeDB(db);

        // Purge from messages.json
        if (fs.existsSync(msgsPath)) {
            try {
                const msgs = JSON.parse(fs.readFileSync(msgsPath, 'utf8'));
                if (msgs[jid]) {
                    delete msgs[jid];
                    fs.writeFileSync(msgsPath, JSON.stringify(msgs, null, 2));
                }
            } catch (e) {
                console.error('Erro ao limpar mensagens no deactivate:', e);
            }
        }

        return true;
    }
    return false;
}

async function saveGroupMenuImage(jid, buffer) {
    const hash = crypto.createHash('md5').update(jid).digest('hex');
    const fileName = `menu_${hash}.png`;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
    const filePath = path.join(uploadsDir, fileName);
    
    // Convert to PNG using Jimp to ensure compatibility
    const image = await Jimp.read(buffer);
    await image.write(filePath);
    
    // Salvar caminho relativo para portabilidade (sempre usando /)
    const relativePath = `uploads/${fileName}`;
    setGroupData(jid, { menuImage: relativePath });
    return filePath;
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
    const finalAuthor = author || `${config.botName}` || 'Bot';
    const isVideo = mimeType.includes('video');
    const tempId = crypto.randomBytes(4).toString('hex');
    
    const inputPath = path.join(tempDir, `stk_in_${tempId}${isVideo ? '.mp4' : '.png'}`);
    const intermediatePath = path.join(tempDir, `stk_inter_${tempId}${isVideo ? '.gif' : '.png'}`);
    const outputPath = path.join(tempDir, `stk_out_${tempId}.webp`);

    try {
        if (!isVideo) {
            const image = await Jimp.read(buffer);
            image.resize({ w: 512, h: 512 });
            const pngBuffer = await image.getBuffer('image/png');
            fs.writeFileSync(inputPath, pngBuffer);
            await webp.cwebp(inputPath, outputPath, "-q 60");
        } else {
            fs.writeFileSync(inputPath, buffer);
            // Convert to GIF first (fallback for old ffmpeg)
            await new Promise((resolve, reject) => {
                ffmpeg(inputPath)
                    .inputOptions(['-t 6'])
                    .outputOptions([
                        '-vf', 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1',
                        '-r', '12'
                    ])
                    .toFormat('gif')
                    .on('end', resolve)
                    .on('error', reject)
                    .save(intermediatePath);
            });
            // Convert GIF to WebP
            await webp.gwebp(intermediatePath, outputPath, "-q 60");
        }
        
        return await addMetadata(fs.readFileSync(outputPath), finalPack, finalAuthor);
    } catch (error) {
        console.error('❌ [CONVERSÃO] Falha:', error.message);
        throw error;
    } finally {
        [inputPath, intermediatePath, outputPath].forEach(p => { 
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch(_) {} 
        });
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
                ]).toFormat('ogg');
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

function getVersion() {
    try {
        return execSync('git log -1 --format=%s').toString().trim();
    } catch (e) {
        return 'v1.0.0';
    }
}

function updateMemberActivity(jid, sender, senderName) {
    const db = readDB();
    if (!db.groups.activity.data[jid]) db.groups.activity.data[jid] = {};
    if (!db.groups.activity.data[jid][sender]) {
        db.groups.activity.data[jid][sender] = { name: senderName, count: 0 };
    }
    db.groups.activity.data[jid][sender].count += 1;
    writeDB(db);
}

function getTopMember(jid) {
    const db = readDB();
    const groupActivity = db.groups.activity.data[jid];
    if (!groupActivity) return 'Nenhum registro hoje';
    
    let topSender = null;
    let maxCount = -1;

    for (const sender in groupActivity) {
        if (groupActivity[sender].count > maxCount) {
            maxCount = groupActivity[sender].count;
            topSender = groupActivity[sender].name;
        }
    }

    return topSender || 'Nenhum registro hoje';
}

async function getAdmins(sock, jid) {
    try {
        const metadata = await sock.groupMetadata(jid);
        return metadata.participants.filter(p => p.admin || p.isSuperAdmin).map(p => p.id);
    } catch (e) {
        return [];
    }
}

module.exports = { 
    readDB, writeDB,
    isActiveGroup, activateGroup, deactivateGroup, 
    getGroupData, setGroupData, saveGroupMenuImage,
    isViewOnce, getMediaMessage, mediaToSticker, stickerToMedia, 
    readStats, incrementRestart, incrementCommand, formatUptime, 
    readConfig, writeConfig, saveMessage, getChatHistory,
    changeSpeed, getBotName, react, getMessageText, getVersion,
    updateMemberActivity, getTopMember, getAdmins
};
