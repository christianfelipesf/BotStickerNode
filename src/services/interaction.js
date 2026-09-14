const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Pasta base: src/media/interacoes/<tipo>/arquivo.gif|mp4|jpg|png|webp
// Ex: src/media/interacoes/beijar/kiss.gif
const BASE_DIR = path.join(__dirname, '..', 'media', 'interacoes');

const SUPPORTED_EXTS = ['.gif', '.mp4', '.jpg', '.jpeg', '.png', '.webp'];

// Tipos válidos = pastas criadas (mantém compat com comandos antigos)
const INTERACTION_TYPES = [
    'beijar',
    'abraco',
    'cafune',
    'tapa',
    'soco',
    'morder',
    'lamber',
    'chute',
    'matar',
    'cutucar',
    'cuddle',
    'chorar',
    'highfive'
];

function getInteractionDir(tipo) {
    return path.join(BASE_DIR, String(tipo || '').toLowerCase());
}

function listLocalInteractionFiles(tipo) {
    const dir = getInteractionDir(tipo);
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
        return [];
    }
    return entries
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .filter((n) => {
            if (n.startsWith('.')) return false;
            if (n.toLowerCase() === 'leia-me.txt' || n.toLowerCase() === 'readme.txt') return false;
            return SUPPORTED_EXTS.includes(path.extname(n).toLowerCase());
        })
        .sort((a, b) => a.localeCompare(b))
        .map((n) => path.join(dir, n));
}

function pickRandom(arr) {
    if (!arr || !arr.length) return null;
    if (arr.length === 1) return arr[0];
    return arr[Math.floor(Math.random() * arr.length)];
}

function mimeForExt(ext) {
    switch (ext.toLowerCase()) {
        case '.gif': return 'image/gif';
        case '.mp4': return 'video/mp4';
        case '.png': return 'image/png';
        case '.webp': return 'image/webp';
        case '.jpg':
        case '.jpeg':
        default: return 'image/jpeg';
    }
}

// Lê um arquivo aleatório da pasta local (sem web).
// Retorna { buffer, mimetype, ext, filePath } ou null se a pasta estiver vazia.
async function getInteractionMedia(tipo) {
    const files = listLocalInteractionFiles(tipo);
    const picked = pickRandom(files);
    if (!picked) return null;
    const ext = path.extname(picked).toLowerCase();
    const buffer = fs.readFileSync(picked);
    if (!buffer || buffer.length < 16) return null;
    return { buffer, mimetype: mimeForExt(ext), ext, filePath: picked };
}

// WhatsApp só anima GIF quando enviado como vídeo MP4 com gifPlayback=true.
// GIF cru enviado como `image` é rejeitado no upload — por isso convertemos aqui.
async function convertGifToMp4(buffer) {
    if (!buffer || buffer.length === 0) return null;
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const inPath = path.join(os.tmpdir(), `inter_${id}.gif`);
    const outPath = path.join(os.tmpdir(), `inter_${id}.mp4`);
    try {
        fs.writeFileSync(inPath, buffer);
        await new Promise((resolve, reject) => {
            let killed = false;
            let ff = null;
            const to = setTimeout(() => { killed = true; try { ff && ff.kill('SIGKILL'); } catch (_) {} reject(new Error('ffmpeg gif->mp4 timeout 30s')); }, 30000);
            // Preserva proporção (sem crop): interações não devem ser cortadas em quadrado.
            ff = spawn('ffmpeg', [
                '-y',
                '-i', inPath,
                '-vf', 'scale=480:-2:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2',
                '-r', '15',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-crf', '23',
                '-preset', 'veryfast',
                '-movflags', '+faststart',
                '-an',
                '-t', '6',
                outPath
            ], { stdio: ['ignore', 'ignore', 'ignore'] });
            ff.on('error', (err) => { clearTimeout(to); reject(err); });
            ff.on('close', (code) => { clearTimeout(to); if (killed) return; code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)); });
        });
        const mp4 = fs.readFileSync(outPath);
        return mp4 && mp4.length > 512 ? mp4 : null;
    } catch (e) {
        console.warn(`⚠️ [interaction] conversão GIF→MP4 falhou: ${e.message}`);
        return null;
    } finally {
        try { fs.unlinkSync(inPath); } catch (_) {}
        try { fs.unlinkSync(outPath); } catch (_) {}
    }
}

// Retorna mídia pronta para envio: prefere MP4 (video gifPlayback).
// { buffer, ext: '.mp4'|'.gif'|..., mimetype, filePath }
async function getInteractionVideoMedia(tipo) {
    const media = await getInteractionMedia(tipo);
    if (!media) return null;
    if (media.ext === '.mp4') return media;
    if (media.ext === '.gif') {
        const mp4 = await convertGifToMp4(media.buffer);
        if (mp4) return { buffer: mp4, mimetype: 'video/mp4', ext: '.mp4', filePath: media.filePath };
        // sem ffmpeg: devolve o gif original para fallback como documento
        return media;
    }
    return media;
}
// Compat: código antigo esperava um Buffer direto (só disco, sem web).
async function fetchInteractionImage(tipo) {
    const media = await getInteractionMedia(tipo);
    if (!media) {
        throw new Error(
            `Sem mídia local para "${tipo}". Coloque um .gif/.mp4 em ${getInteractionDir(tipo)}`
        );
    }
    return media.buffer;
}

// Compat: export antigo ENDPOINTS não é mais usado (sem web).
// Mantido vazio para não quebrar imports.
const ENDPOINTS = {};

module.exports = {
    BASE_DIR,
    INTERACTION_TYPES,
    SUPPORTED_EXTS,
    getInteractionDir,
    listLocalInteractionFiles,
    getInteractionMedia,
    getInteractionVideoMedia,
    convertGifToMp4,
    fetchInteractionImage,
    fetchImageBuffer: async () => { throw new Error('fetchImageBuffer removido: interações agora são locais (sem web).'); },
    ENDPOINTS
};
