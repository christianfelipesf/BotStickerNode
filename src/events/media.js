const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

const DOWNLOAD_TIMEOUT = 30000;

function downloadWithTimeout(msg, opts) {
    let timeout;
    const dl = downloadMediaMessage(msg, 'buffer', {}, opts).catch(e => { clearTimeout(timeout); throw e; });
    // evita unhandled rejection quando race vence no timeout
    dl.catch(() => {});
    return Promise.race([
        dl.finally(() => clearTimeout(timeout)),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Download timeout')), DOWNLOAD_TIMEOUT); })
    ]);
}
const {
    getMediaMessage, react, reactStatus, isViewOnce,
    stickerToMedia, getBotName, mediaToSticker,
    changeSpeed, mediaToGif, mediaToGifVideo,
    isDashboardEnabled, groupMetadataCached, getGroupParticipantName,
    getGroupData
} = require('../database/utils');

function isLidJid(jid) { return typeof jid === 'string' && jid.endsWith('@lid'); }
function resolveDisplayNum(jid, fallbackPn) {
    if (!jid) return null;
    if (isLidJid(jid)) {
        if (fallbackPn && String(fallbackPn).endsWith('@s.whatsapp.net')) {
            const p = String(fallbackPn).split('@')[0].split(':')[0];
            if (/^\d{8,15}$/.test(p)) return p;
        }
        return null;
    }
    const p = String(jid).split('@')[0].split(':')[0];
    if (/^\d{8,15}$/.test(p)) return p;
    return null;
}

async function revealViewOnce(sock, from, m, lastBotResponse, GLOBAL_COOLDOWN, explicitOpts = {}) {
    const sender = m.key.participant || m.key.remoteJid;
    const explicitName = explicitOpts.senderName || null;
    try {
        const mediaMessage = getMediaMessage(m.message);
        if (!mediaMessage) return lastBotResponse;
        const isVideo = !!mediaMessage.videoMessage;
        const isAudio = !!mediaMessage.audioMessage;
        const originalCaption = mediaMessage.imageMessage?.caption || mediaMessage.videoMessage?.caption || '';

        lastBotResponse = await react(sock, m, '👀', lastBotResponse, GLOBAL_COOLDOWN);

        const buffer = await downloadWithTimeout(
            { key: m.key, message: mediaMessage },
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        ).catch(() => null);

        if (!buffer) {
            return await reactStatus(sock, m, from, false, '🔓', '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        let pushForLookup = m.pushName || null;
        if (!pushForLookup && explicitName && explicitOpts.senderJid && sender === explicitOpts.senderJid) {
            pushForLookup = explicitName;
        } else if (!pushForLookup && explicitName && !explicitOpts.senderJid) {
            pushForLookup = explicitName;
        }
        let senderName = await getGroupParticipantName(sock, from, sender, pushForLookup);
        if (!senderName || senderName === 'Usuário') {
            senderName = 'Usuário';
        }
        // visual igual ao de mídia convertida (╭─── / │ / ╰───────────────)
        const botNameForReveal = (() => {
            try {
                const cfg = explicitOpts.config || require('../database/utils').readConfig();
                return getBotName(from, cfg);
            } catch (_) { return 'Bot'; }
        })();
        const fallbackPnReveal = m.key?.participantPn || m.key?.senderPn || null;
        const resolvedNumReveal = resolveDisplayNum(sender, fallbackPnReveal);
        const displayReveal = (senderName && !['usuario','usuário'].includes(String(senderName).trim().toLowerCase()))
            ? String(senderName).trim().slice(0,30)
            : (resolvedNumReveal ? `@${resolvedNumReveal}` : 'Usuário');
        const captionLegenda = originalCaption ? String(originalCaption).trim().slice(0, 900) : '';
        let revealCaption;
        if (captionLegenda) {
            revealCaption = `╭─── *🔓 MÍDIA REVELADA* ───\n` +
                `│ 👤 *De:* ${displayReveal}\n` +
                `│ 🤖 *Por:* ${botNameForReveal}\n` +
                `│ 💬 *Legenda:* ${captionLegenda}\n` +
                `│ ⚡ *Status:* Concluído\n` +
                `╰───────────────`;
        } else {
            revealCaption = `╭─── *🔓 MÍDIA REVELADA* ───\n` +
                `│ 👤 *De:* ${displayReveal}\n` +
                `│ 🤖 *Por:* ${botNameForReveal}\n` +
                `│ ⚡ *Status:* Concluído\n` +
                `╰───────────────`;
        }
        const opts = { mentions: [sender], quoted: m };

        const dashboardOn = isDashboardEnabled(from);
        const groupMetadata = from.endsWith('@g.us') ? await groupMetadataCached(sock, from).catch(() => ({ subject: 'Grupo' })) : { subject: 'Privado' };
        const mediaType = isAudio ? 'audio' : (isVideo ? 'video' : 'image');

        if (dashboardOn) {
            const dataBase64 = buffer.toString('base64');
            const mime = isAudio ? 'audio/mp4' : (isVideo ? 'video/mp4' : 'image/jpeg');
            let mediaInfo;
            try {
                mediaInfo = require('../dashboard/dashboard').mediaForLogReceived(
                    { type: mediaType, url: `data:${mime};base64,${dataBase64}` },
                    m.key?.id
                );
            } catch (_) {
                mediaInfo = { type: mediaType, url: `data:${mime};base64,${dataBase64}` };
            }

            const phoneReveal = resolveDisplayNum(sender, fallbackPnReveal) || null;
            require('../dashboard/dashboard').log('action', groupMetadata.subject, `Mídia Revelada (${mediaType})`, senderName, phoneReveal, mediaInfo, { toJid: from, messageId: m.key?.id, senderJid: sender, fromMe: !!m.key?.fromMe, hidden: true });
        }

        if (isAudio) await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, opts);
        else if (isVideo) await sock.sendMessage(from, { video: buffer, caption: revealCaption }, opts);
        else await sock.sendMessage(from, { image: buffer, caption: revealCaption }, opts);

        return await reactStatus(sock, m, from, true, '🔓', '❌', lastBotResponse, GLOBAL_COOLDOWN);
    } catch (error) {
        return await reactStatus(sock, m, from, false, '🔓', '❌', lastBotResponse, GLOBAL_COOLDOWN);
    }
}

function buildConvertedCaption(senderJid, botName, senderName, fallbackPn) {
    const bot = botName || 'Bot';
    const isGeneric = (n) => !n || ['usuario','usuário'].includes(String(n).trim().toLowerCase());
    let display = null;
    if (senderName && !isGeneric(senderName)) display = String(senderName).trim().slice(0,30);
    if (!display) {
        const num = resolveDisplayNum(senderJid, fallbackPn);
        display = num ? `@${num}` : 'Usuário';
    } else {
        // nome já resolve — sem @, evita número aleatório de LID
        display = display;
    }
    // Se display é @numero, mantém @; se é nome, sem @
    const line = display.startsWith('@') ? `│ 👤 *Solicitado por:* ${display}` : `│ 👤 *Solicitado por:* ${display}`;
    return `╭─── *📱 MÍDIA CONVERTIDA* ───\n${line}\n│ 🤖 *Por:* ${bot}\n│ ⚡ *Status:* Concluído\n╰───────────────`;
}

async function handleMediaCommand(sock, from, m, action, config, lastBotResponse, GLOBAL_COOLDOWN, speedOrOpts = 1.0) {
    let speed = 1.0;
    let explicitOpts = {};
    if (typeof speedOrOpts === 'object' && speedOrOpts !== null) {
        explicitOpts = speedOrOpts;
        speed = explicitOpts.speed ?? 1.0;
    } else {
        speed = speedOrOpts;
    }
    try {
        let mediaMessage = null;
        const quotedInfo = m.message.extendedTextMessage?.contextInfo;
        const quotedMsg = quotedInfo?.quotedMessage;
        let targetMsg = null;

        if (quotedMsg) {
            mediaMessage = getMediaMessage(quotedMsg);
            if (mediaMessage) targetMsg = {
                key: {
                    remoteJid: from,
                    id: quotedInfo.stanzaId,
                    participant: quotedInfo.participant || from
                },
                message: mediaMessage,
                pushName: quotedInfo.pushName
            };
        } else {
            mediaMessage = getMediaMessage(m.message);
            if (mediaMessage) targetMsg = m;
        }

        if (!mediaMessage || !targetMsg) {
            return await reactStatus(sock, m, from, false, '✅', '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const isSticker = !!mediaMessage.stickerMessage;
        const isViewOnceMsg = isViewOnce(targetMsg.message);

        lastBotResponse = await react(sock, m, '⏳', lastBotResponse, GLOBAL_COOLDOWN);

        const buffer = await downloadWithTimeout(
            targetMsg,
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );

        if (!buffer) throw new Error();

        if (action === 'reveal') {
            const revealOpts = { ...explicitOpts, config };
            return await revealViewOnce(sock, from, targetMsg, lastBotResponse, GLOBAL_COOLDOWN, revealOpts);
        }

        // caption padrão para mídias convertidas (estilo menu) — usa nome, evita LID aleatório
        const senderJid = m.key.participant || m.key.remoteJid || from;
        const fallbackPn = m.key?.participantPn || m.key?.senderPn || null;
        const senderNameForCaption = m.pushName || null;
        const botNameForCaption = getBotName(from, config);
        const captionConvertido = buildConvertedCaption(senderJid, botNameForCaption, senderNameForCaption, fallbackPn);

        if (action === 'toimg') {

            if (isSticker) {
                console.log(`[STICKER-LOG] handleMediaCommand toimg isAnimated=${!!mediaMessage.stickerMessage.isAnimated} quotedBuffer=${buffer.length} bytes`);
                const converted = await stickerToMedia(buffer, !!mediaMessage.stickerMessage.isAnimated);
                console.log(`[STICKER-LOG] handleMediaCommand toimg converted mime=${converted.mime} bytes=${converted.buffer.length}`);
                await sock.sendMessage(from, { [converted.mime.startsWith('image/') ? 'image' : 'video']: converted.buffer, caption: captionConvertido }, { quoted: m });
            } else {
                await sock.sendMessage(from, { [mediaMessage.imageMessage ? 'image' : 'video']: buffer, caption: captionConvertido }, { quoted: m });
            }
        } else if (action === 'sticker') {
            if (isSticker) {
                const converted = await stickerToMedia(buffer, !!mediaMessage.stickerMessage.isAnimated);
                await sock.sendMessage(from, { [converted.mime.startsWith('image/') ? 'image' : 'video']: converted.buffer, caption: captionConvertido }, { quoted: m });
            } else {
                const detectedMime = mediaMessage.videoMessage
                    ? (mediaMessage.videoMessage.mimetype || 'video/mp4')
                    : (mediaMessage.imageMessage?.mimetype || 'image/jpeg');
                // pack/author: 1) explícito via !s pack/autor, 2) per-grupo se configurado, 3) fallback requester/bot
                // Antes buscava getStickerPackForJid que sempre retorna "Antigravity Bot🪐" (global default) e mascarava pushName
                let pack = explicitOpts.pack || null;
                let author = explicitOpts.author || null;
                if (!pack) {
                    try {
                        const gd = getGroupData(from);
                        if (gd && gd.stickerPack) pack = String(gd.stickerPack).slice(0, 30) || null;
                    } catch (_) {}
                }
                if (!author) {
                    try {
                        const gd = getGroupData(from);
                        if (gd && gd.stickerAuthor) author = String(gd.stickerAuthor).slice(0, 30) || null;
                    } catch (_) {}
                }
                if (!pack) pack = (m.pushName || 'Usuário').slice(0, 30) || 'Usuário';
                if (!author) author = getBotName(from, config);
                const requesterName = pack;
                const botName = author;
                try {
                    console.log(`[STICKER-LOG] handleMediaCommand sticker input mime=${detectedMime} bytes=${buffer.length} from=${from} by=${requesterName} pack="${pack}" author="${author}" explicit=${JSON.stringify(explicitOpts)}`); 
                    const stickerBuffer = await mediaToSticker(buffer, detectedMime, pack, author);
                    console.log(`[STICKER-LOG] handleMediaCommand sticker gerado ${stickerBuffer.length} bytes header=${stickerBuffer.slice(0,4).toString()} WEBP=${stickerBuffer.slice(8,12).toString()}`);
                    if (!stickerBuffer || stickerBuffer.length < 64) throw new Error('Sticker gerado vazio');
                    if (stickerBuffer.length > 1024 * 1024) throw new Error('Sticker muito grande (>1MB)');
                    const header = Buffer.isBuffer(stickerBuffer) ? stickerBuffer.slice(0, 12) : null;
                    if (header && (header.slice(0, 4).toString() !== 'RIFF' || header.slice(8, 12).toString() !== 'WEBP')) {
                        throw new Error('Sticker gerado inválido');
                    }
                    await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
                } catch (stickerErr) {
                    console.error('❌ [STICKER] Falha ao gerar:', stickerErr.message);
                    await sock.sendMessage(from, { text: '❌ Não foi possível gerar o sticker desse vídeo. Tente outro ou envie uma imagem.' }, { quoted: m });
                    throw stickerErr;
                }
            }
        } else if (action === 'togif') {
            const isSticker = !!mediaMessage.stickerMessage;
            if (!isSticker && !mediaMessage.videoMessage) {
                await sock.sendMessage(from, { text: '❌ Marque um vídeo ou sticker animado.' }, { quoted: m });
                return lastBotResponse;
            }
            // Detecta sticker animado de verdade (ANIM chunk) — estático falha de forma silenciosa antes
            let isAnimatedSticker = !!mediaMessage.stickerMessage?.isAnimated;
            try { if (isSticker && buffer && buffer.includes(Buffer.from('ANIM'))) isAnimatedSticker = true; } catch (_) {}
            if (isSticker && !isAnimatedSticker) {
                await sock.sendMessage(from, { text: '❌ Esse sticker é estático. Use *!toimg* para converter estáticos e *!togif* apenas em stickers animados/vídeos.' }, { quoted: m });
                return await reactStatus(sock, m, from, false, '✅', '❌', lastBotResponse, GLOBAL_COOLDOWN);
            }
            const mimeType = isSticker ? 'sticker/webp' : (mediaMessage.videoMessage?.mimetype || 'video/mp4');
            let gifVideo;
            try {
                gifVideo = await mediaToGifVideo(buffer, mimeType);
            } catch (e) {
                console.error(`❌ [TOGIF] mediaToGifVideo falhou isSticker=${isSticker} mime=${mimeType} bytes=${buffer.length} err=${e.message}`);
                const msg = String(e.message||'');
                if (msg.includes('muito grande')) await sock.sendMessage(from, { text: '❌ Mídia muito grande (max 20MB).' }, { quoted: m });
                else if (msg.includes('timeout')) await sock.sendMessage(from, { text: '❌ Tempo esgotado ao converter. Tente um vídeo mais curto.' }, { quoted: m });
                else if (msg.includes('sem frames')) await sock.sendMessage(from, { text: '❌ Não consegui ler os frames desse sticker. Tente outro.' }, { quoted: m });
                else await sock.sendMessage(from, { text: `❌ Falha ao converter para GIF: ${msg.slice(0,120)}` }, { quoted: m });
                throw e;
            }
            await sock.sendMessage(from, { video: gifVideo, gifPlayback: true, mimetype: 'video/mp4', caption: captionConvertido }, { quoted: m });
        } else if (action === 'speed') {
            if (!mediaMessage.videoMessage && !mediaMessage.audioMessage) {
                await sock.sendMessage(from, { text: '❌ Marque um vídeo ou áudio.' }, { quoted: m });
                return lastBotResponse;
            }
            const processed = await changeSpeed(buffer, mediaMessage.videoMessage ? 'video/mp4' : 'audio/mp4', speed);
            if (mediaMessage.videoMessage) await sock.sendMessage(from, { video: processed, caption: captionConvertido }, { quoted: m });
            else await sock.sendMessage(from, { audio: processed, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: m });
        }

        return await reactStatus(sock, m, from, true, '✅', '❌', lastBotResponse, GLOBAL_COOLDOWN);
    } catch (error) {
        console.error(`❌ [handleMediaCommand:${action}] erro: ${error.message} | stack=${error.stack?.split('\n')[1]?.trim()||''}`);
        try { require('../dashboard/dashboard').log('error', 'MÍDIA', `❌ ${action} falhou: ${error.message.slice(0,180)}`, 'Sistema', '—'); } catch (_) {}
        return await reactStatus(sock, m, from, false, '✅', '❌', lastBotResponse, GLOBAL_COOLDOWN);
    }
}

module.exports = { revealViewOnce, handleMediaCommand };
