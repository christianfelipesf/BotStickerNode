const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Jimp } = require('jimp');

const MENUS_DIR = path.join(process.cwd(), 'src', 'media', 'menus');
const VALID_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function listMenuImages() {
    try {
        if (!fs.existsSync(MENUS_DIR)) return [];
        return fs.readdirSync(MENUS_DIR)
            .filter(f => VALID_EXT.has(path.extname(f).toLowerCase()))
            .map(f => path.join(MENUS_DIR, f));
    } catch (_) { return []; }
}

function pickRandomMenuImage() {
    const images = listMenuImages();
    if (images.length === 0) return null;
    return images[Math.floor(Math.random() * images.length)];
}

async function cropTo16x9(buffer) {
    const image = await Jimp.read(buffer);
    const w = image.bitmap.width;
    const h = image.bitmap.height;
    if (!w || !h) return await image.getBuffer('image/jpeg', { quality: 90 });
    const target = 16 / 9;
    const current = w / h;
    let cropW, cropH, x, y;
    if (current > target) {
        cropH = h;
        cropW = Math.round(h * target);
        x = Math.round((w - cropW) / 2);
        y = 0;
    } else {
        cropW = w;
        cropH = Math.round(w / target);
        x = 0;
        y = Math.round((h - cropH) / 2);
    }
    // Jimp 1.6 usa objeto {x,y,w,h} / fallback posicional
    try { image.crop({ x, y, w: cropW, h: cropH }); } catch (_) { try { image.crop(x, y, cropW, cropH); } catch (_) {} }
    return await image.getBuffer('image/jpeg', { quality: 90 });
}

async function getRawGroupBuffer(sock, jid) {
    try {
        const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
        if (!url) return null;
        // bust CDN cache — WhatsApp e axios podem cachear ppUrl
        const bustUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
        const resp = await axios.get(bustUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
        });
        if (!resp.data) return null;
        return Buffer.from(resp.data);
    } catch (_) { return null; }
}

async function getRawFallbackBuffer(jid, getGroupDataFn) {
    try {
        let filePath = null;
        if (typeof getGroupDataFn === 'function') {
            const gd = getGroupDataFn(jid);
            if (gd?.menuImage) {
                const p = path.isAbsolute(gd.menuImage) ? gd.menuImage : path.join(process.cwd(), gd.menuImage);
                if (fs.existsSync(p)) filePath = p;
            }
        }
        if (!filePath) filePath = pickRandomMenuImage();
        if (!filePath) filePath = path.join(process.cwd(), 'src', 'media', 'logo.png');
        if (!filePath || !fs.existsSync(filePath)) return null;
        return fs.readFileSync(filePath);
    } catch (_) { return null; }
}

// mantidos p/ compatibilidade
async function getCroppedGroupImage(sock, jid) {
    const raw = await getRawGroupBuffer(sock, jid);
    return raw ? await cropTo16x9(raw) : null;
}
async function getCroppedFallbackImage(jid, getGroupDataFn) {
    const raw = await getRawFallbackBuffer(jid, getGroupDataFn);
    return raw ? await cropTo16x9(raw) : null;
}

module.exports = {
    name: 'linkgp',
    aliases: ['linkgrupo', 'linkdogrupo', 'gplink', 'invitegp'],
    category: 'grupos',
    description: 'Mostra o link de convite do grupo',
    async execute(sock, m, { from, isGroup, config }) {
        if (!isGroup) {
            return sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
        }

        try {
            const code = await sock.groupInviteCode(from);
            const link = `https://chat.whatsapp.com/${code}`;
            const { groupMetadataCached, getBotName, getGroupData } = require('../database/utils');
            const meta = await groupMetadataCached(sock, from).catch(() => null);
            const subject = meta?.subject || 'Grupo';
            const botName = getBotName ? getBotName(from, config) : (config?.botName || 'Bot');

            const memberCount = Array.isArray(meta?.participants) ? meta.participants.length : null;

            let creationDate = '—';
            const creationRaw = meta?.creation;
            if (creationRaw) {
                try {
                    const ts = Number(creationRaw) > 1e12 ? Number(creationRaw) : Number(creationRaw) * 1000;
                    const d = new Date(ts);
                    if (!isNaN(d.getTime())) {
                        creationDate = d.toLocaleDateString('pt-BR');
                    }
                } catch (_) {}
            }

            const caption = `*${botName} — ${subject}* 🔗\n_link de convite_\n\n` +
                `╭─── *CONVITE* ───\n` +
                `│ 🔗 ${link}\n` +
                `╰───────────────\n\n` +
                `╭─── *INFO DO GRUPO* ───\n` +
                `│ 👥 *Membros:* ${memberCount ?? '—'}\n` +
                `│ 📅 *Criado em:* ${creationDate}\n` +
                `╰───────────────`;

            // Preview (em vez de imagem) — mesma info visual do !menu, com thumbnail 16:9 da foto do grupo
            if (!config.showLogoInMenu) {
                return await sock.sendMessage(from, { text: caption }, { quoted: m });
            }

            // preview simples 16:9 — sem blur, só crop center
            let raw = await getRawGroupBuffer(sock, from);
            if (!raw) raw = await getRawFallbackBuffer(from, getGroupData);
            let thumb = null;
            if (raw) {
                try { thumb = await cropTo16x9(raw); } catch (_) { thumb = null; }
                if (thumb) {
                    try {
                        const tImg = await Jimp.read(thumb);
                        if (tImg.bitmap.width > 720) {
                            const h = Math.round(720 * 9 / 16);
                            tImg.resize({ w: 720, h });
                            thumb = await tImg.getBuffer('image/jpeg', { quality: 85 });
                        }
                    } catch (_) {}
                }
            }

            if (thumb) {
                return await sock.sendMessage(from, {
                    text: caption,
                    contextInfo: {
                        externalAdReply: {
                            title: subject,
                            body: `👥 ${memberCount ?? '—'} membros • 📅 ${creationDate}`,
                            thumbnail: thumb,
                            mediaType: 1,
                            mediaUrl: link,
                            sourceUrl: link,
                            renderLargerThumbnail: true,
                            showAdAttribution: false
                        }
                    }
                }, { quoted: m });
            } else {
                // sem thumb, envia preview via link nativo
                return await sock.sendMessage(from, {
                    text: caption,
                    contextInfo: {
                        externalAdReply: {
                            title: subject,
                            body: `👥 ${memberCount ?? '—'} membros • 📅 ${creationDate}`,
                            mediaType: 1,
                            mediaUrl: link,
                            sourceUrl: link,
                            showAdAttribution: false
                        }
                    }
                }, { quoted: m });
            }
        } catch (e) {
            const msg = String(e?.message || e || '').toLowerCase();
            const isAdminError = msg.includes('not-authorized') || msg.includes('forbidden') || msg.includes('401') || msg.includes('403') || msg.includes('admin');
            if (isAdminError) {
                return sock.sendMessage(from, { text: '❌ Não consegui pegar o link. O bot precisa ser *admin* do grupo para gerar o convite.' }, { quoted: m });
            }
            console.error('[linkgp] erro:', e?.message || e);
            return sock.sendMessage(from, { text: '❌ Erro ao obter o link do grupo. Tente novamente mais tarde.' }, { quoted: m });
        }
    }
};
