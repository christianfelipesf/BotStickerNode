const axios = require('axios');

// resolve @lid -> @s.whatsapp.net via metadados (profilePictureUrl costuma falhar com lid puro)
function resolvePhoneJid(target, participants) {
    if (!target || !Array.isArray(participants)) return null;
    const norm = String(target).split('@')[0].split(':')[0];
    for (const p of participants) {
        const cands = [p.id, p.jid, p.lid, p.phoneNumber].filter(Boolean);
        for (const c of cands) {
            if (String(c).split('@')[0].split(':')[0] === norm) {
                if (p.id && p.id.endsWith('@s.whatsapp.net')) return p.id;
                if (p.jid && p.jid.endsWith('@s.whatsapp.net')) return p.jid;
                if (p.phoneNumber && String(p.phoneNumber).includes('@')) return String(p.phoneNumber);
            }
        }
    }
    return null;
}

function isImageBuffer(buf) {
    if (!buf || buf.length < 100) return false;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true; // jpeg
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true; // png
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true; // webp (RIFF....WEBP)
    return false;
}

async function fetchImageBuffer(url) {
    if (!url) return null;
    try {
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            maxContentLength: 5 * 1024 * 1024,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        }).catch(() => null);
        if (!res || !res.data) return null;
        const buf = Buffer.from(res.data);
        return isImageBuffer(buf) ? buf : null;
    } catch (_) { return null; }
}

module.exports = {
    name: 'perfil',
    aliases: ['pp', 'profile'],
    category: 'geral',
    description: 'Exibe a foto de perfil de um usuário',
    async execute(sock, m, { from, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName } = utils;
        let currentBotResponse = await react(sock, m, '👤', lastBotResponse, GLOBAL_COOLDOWN);

        try {
            const qInfo = m.message.extendedTextMessage?.contextInfo;
            const target = qInfo?.mentionedJid?.[0] || qInfo?.participant || sender;
            // tenta jid original + equivalente @s.whatsapp.net (caso @lid)
            let participants = [];
            try {
                if (from && from.endsWith('@g.us')) {
                    const meta = await utils.groupMetadataCached(sock, from).catch(() => null);
                    if (Array.isArray(meta?.participants)) participants = meta.participants;
                }
            } catch (_) {}
            const tries = [target];
            const phone = resolvePhoneJid(target, participants);
            if (phone && phone !== target) tries.push(phone);

            let ppBuffer = null;
            for (const t of tries) {
                try {
                    const url = await sock.profilePictureUrl(t, 'image').catch(() => null);
                    if (!url) continue;
                    ppBuffer = await fetchImageBuffer(url);
                    if (ppBuffer) break;
                } catch (_) { continue; }
            }

            const botName = getBotName(from, config || {});
            const isLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid');
            const toDisplay = (jid, fallbackName) => {
                if (isLid(jid)) return fallbackName && !['usuario','usuário'].includes(String(fallbackName).trim().toLowerCase()) ? String(fallbackName).trim().slice(0,30) : 'Usuário';
                const num = String(jid||'').split('@')[0].split(':')[0];
                return /^\d{8,15}$/.test(num) ? `@${num}` : (fallbackName ? String(fallbackName).trim().slice(0,30) : 'Usuário');
            };
            // tenta pegar nome via pushName se disponível no m
            const pushName = m.pushName || null;
            const quotedName = m.message?.extendedTextMessage?.contextInfo?.pushName || null;
            const targetDisplay = toDisplay(target, quotedName || null);
            const senderDisplay = toDisplay(sender, pushName || null);
            const isSelf = String(target||'').split('@')[0] === String(sender||'').split('@')[0];

            // visual igual ao de mídia convertida (╭─── / │ / ╰───────────────)
            const caption = isSelf
                ? `╭─── *👤 PERFIL* ───\n` +
                  `│ 👤 *Usuário:* ${targetDisplay}\n` +
                  `│ 🤖 *Por:* ${botName}\n` +
                  `╰───────────────`
                : `╭─── *👤 PERFIL* ───\n` +
                  `│ 👤 *Usuário:* ${targetDisplay}\n` +
                  `│ 👥 *Solicitado por:* ${senderDisplay}\n` +
                  `│ 🤖 *Por:* ${botName}\n` +
                  `╰───────────────`;

            const mentions = isSelf ? [target] : [target, sender];

            if (!ppBuffer) {
                await sock.sendMessage(from, {
                    text: caption + `\n│ 🖼️ *Foto:* sem foto visível (privada ou inexistente) 🙈`,
                    mentions
                }, { quoted: m });
                return currentBotResponse;
            }

            await sock.sendMessage(from, {
                image: ppBuffer,
                caption,
                mentions
            }, { quoted: m });
        } catch (e) {
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
