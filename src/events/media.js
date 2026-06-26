const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

const DOWNLOAD_TIMEOUT = 30000;

function downloadWithTimeout(msg, opts) {
    return Promise.race([
        downloadMediaMessage(msg, 'buffer', {}, opts),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Download timeout')), DOWNLOAD_TIMEOUT))
    ]);
}
const {
    getMediaMessage, react, reactStatus, isViewOnce,
    stickerToMedia, getBotName, mediaToSticker,
    changeSpeed,
    isDashboardEnabled
} = require('../database/utils');

async function revealViewOnce(sock, from, m, lastBotResponse, GLOBAL_COOLDOWN) {
    const sender = m.key.participant || m.key.remoteJid;
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

        const senderName = m.pushName || 'Usuário';
        let revealCaption = `🔓 *Mídia Revelada!* 🔓\n👤 *De:* ${senderName}${originalCaption ? `\n💬 *Legenda:* ${originalCaption}` : ''}`;
        const opts = { mentions: [sender], quoted: m };

        const dashboardOn = isDashboardEnabled(from);
        const groupMetadata = from.endsWith('@g.us') ? await sock.groupMetadata(from).catch(() => ({ subject: 'Grupo' })) : { subject: 'Privado' };
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

            require('../dashboard/dashboard').log('action', groupMetadata.subject, `Mídia Revelada (${mediaType})`, senderName, sender.split('@')[0], mediaInfo, { toJid: from, messageId: m.key?.id, senderJid: sender, fromMe: !!m.key?.fromMe, hidden: true });
        }

        if (isAudio) await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, opts);
        else if (isVideo) await sock.sendMessage(from, { video: buffer, caption: revealCaption }, opts);
        else await sock.sendMessage(from, { image: buffer, caption: revealCaption }, opts);

        return await reactStatus(sock, m, from, true, '🔓', '❌', lastBotResponse, GLOBAL_COOLDOWN);
    } catch (error) {
        return await reactStatus(sock, m, from, false, '🔓', '❌', lastBotResponse, GLOBAL_COOLDOWN);
    }
}

async function handleMediaCommand(sock, from, m, action, config, lastBotResponse, GLOBAL_COOLDOWN, speed = 1.0) {
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

        if (isViewOnceMsg && action !== 'reveal') {
            lastBotResponse = await revealViewOnce(sock, from, targetMsg, lastBotResponse, GLOBAL_COOLDOWN);
        }

        const buffer = await downloadWithTimeout(
            targetMsg,
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
        );

        if (!buffer) throw new Error();

        if (action === 'reveal' || action === 'toimg') {
            if (isViewOnceMsg) {
                lastBotResponse = await revealViewOnce(sock, from, targetMsg, lastBotResponse, GLOBAL_COOLDOWN);
                if (action === 'reveal') return lastBotResponse;
            }

            if (isSticker) {
                const converted = await stickerToMedia(buffer, !!mediaMessage.stickerMessage.isAnimated);
                await sock.sendMessage(from, { [converted.mime.startsWith('image/') ? 'image' : 'video']: converted.buffer, caption: `✅ Convertido!` }, { quoted: m });
            } else {
                await sock.sendMessage(from, { [mediaMessage.imageMessage ? 'image' : 'video']: buffer, caption: '✅ Aqui está sua mídia!' }, { quoted: m });
            }
        } else if (action === 'sticker') {
            if (isSticker) {
                const converted = await stickerToMedia(buffer, !!mediaMessage.stickerMessage.isAnimated);
                await sock.sendMessage(from, { [converted.mime.startsWith('image/') ? 'image' : 'video']: converted.buffer, caption: '✅ Convertido!' }, { quoted: m });
            } else {
                const requesterName = m.pushName || 'Usuário';
                const botName = getBotName(from, config);
                const detectedMime = mediaMessage.videoMessage
                    ? (mediaMessage.videoMessage.mimetype || 'video/mp4')
                    : (mediaMessage.imageMessage?.mimetype || 'image/jpeg');
                try {
                    const stickerBuffer = await mediaToSticker(buffer, detectedMime, requesterName, `${botName}`);
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
        } else if (action === 'speed') {
            if (!mediaMessage.videoMessage && !mediaMessage.audioMessage) {
                await sock.sendMessage(from, { text: '❌ Marque um vídeo ou áudio.' }, { quoted: m });
                return lastBotResponse;
            }
            const processed = await changeSpeed(buffer, mediaMessage.videoMessage ? 'video/mp4' : 'audio/mp4', speed);
            if (mediaMessage.videoMessage) await sock.sendMessage(from, { video: processed, caption: `✅ Vídeo ${speed}x` }, { quoted: m });
            else await sock.sendMessage(from, { audio: processed, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: m });
        }

        return await reactStatus(sock, m, from, true, '✅', '❌', lastBotResponse, GLOBAL_COOLDOWN);
    } catch (error) {
        return await reactStatus(sock, m, from, false, '✅', '❌', lastBotResponse, GLOBAL_COOLDOWN);
    }
}

module.exports = { revealViewOnce, handleMediaCommand };
