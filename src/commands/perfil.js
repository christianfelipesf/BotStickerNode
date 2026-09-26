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
    description: 'Exibe a foto de perfil + região/clima/país pelo número (DDD/DDI)',
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
            const GENERIC_NAMES = new Set(['usuario', 'usuário', 'utilizador', 'user', 'desconhecido', 'nao identificado', 'não identificado', 'null', 'undefined']);
            const cleanName = (n) => {
                const s = String(n || '').trim().slice(0, 30);
                if (s.length < 2) return null;
                if (GENERIC_NAMES.has(s.toLowerCase())) return null;
                if (!/[\p{L}]/u.test(s)) return null; // só dígitos/símbolos não é nome
                return s;
            };
            const phoneOf = (jid) => {
                if (typeof jid !== 'string' || !jid.endsWith('@s.whatsapp.net')) return null;
                const num = jid.split('@')[0].split(':')[0];
                return /^\d{8,15}$/.test(num) ? jid : null;
            };
            // Exibe nome real quando existe; senão o @número; nunca o genérico "Usuário"
            // (era isso que gerava o "Usuário: Usuário").
            const toDisplay = (jid, phoneJid, fallbackName) => {
                const name = cleanName(fallbackName);
                if (name) return name;
                const pj = phoneOf(phoneJid) || phoneOf(jid);
                if (pj) return `@${pj.split('@')[0].split(':')[0]}`;
                if (!isLid(jid)) {
                    const num = String(jid || '').split('@')[0].split(':')[0];
                    if (/^\d{8,15}$/.test(num)) return `@${num}`;
                }
                return 'não identificado';
            };
            // tenta pegar nome via pushName se disponível no m
            const pushName = m.pushName || null;
            const quotedName = m.message?.extendedTextMessage?.contextInfo?.pushName || null;
            // Telefone do remetente: sender pode vir como @lid — o nº real vem no Pn da chave
            const msgPn = m.key?.participantPn || m.key?.senderPn || null;
            const senderPhone = phoneOf(sender) || phoneOf(msgPn);
            const targetNorm = String(target || '').split('@')[0].split(':')[0];
            const senderNorm = String(sender || '').split('@')[0].split(':')[0];
            // Telefone do alvo: metadados > próprio JID > Pn (só quando o alvo é o remetente)
            let targetPhone = phone || phoneOf(target);
            if (!targetPhone && senderPhone && targetNorm && targetNorm === senderNorm) targetPhone = senderPhone;
            const targetDisplay = toDisplay(target, targetPhone, quotedName || (targetNorm === senderNorm ? pushName : null));
            const senderDisplay = toDisplay(sender, senderPhone, pushName || null);
            const isSelf = String(target||'').split('@')[0] === String(sender||'').split('@')[0];

            // Região / clima / país pelo número (DDD cobre a área, não a cidade exata)
            let regiaoLines = [];
            try {
                const { getRegiaoInfo, formatRegiaoLines } = require('../services/regiao');
                const numJid = targetPhone || ((typeof target === 'string' && target.endsWith('@s.whatsapp.net')) ? target : null);
                const digits = numJid ? String(numJid).split('@')[0].split(':')[0].replace(/\D/g, '') : '';
                regiaoLines = formatRegiaoLines(digits ? getRegiaoInfo(digits) : null);
            } catch (_) { regiaoLines = []; }
            const regiaoBlock = regiaoLines.length ? `\n${regiaoLines.join('\n')}` : '';

            // visual igual ao de mídia convertida (╭─── / │ / ╰───────────────)
            const caption = isSelf
                ? `╭─── *👤 PERFIL* ───\n` +
                  `│ 👤 *Usuário:* ${targetDisplay}${regiaoBlock}\n` +
                  `│ 🤖 *Por:* ${botName}\n` +
                  `╰───────────────`
                : `╭─── *👤 PERFIL* ───\n` +
                  `│ 👤 *Usuário:* ${targetDisplay}${regiaoBlock}\n` +
                  `│ 👥 *Solicitado por:* ${senderDisplay}\n` +
                  `│ 🤖 *Por:* ${botName}\n` +
                  `╰───────────────`;

            const _mentions = isSelf ? [target, targetPhone] : [target, targetPhone, sender, senderPhone];
            const mentions = [...new Set(_mentions.filter(Boolean))];

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
