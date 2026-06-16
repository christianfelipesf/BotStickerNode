const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { 
    getMediaMessage, react, isViewOnce, 
    stickerToMedia, getBotName, mediaToSticker, 
    changeSpeed 
} = require('../utils');

async function revealViewOnce(sock, from, m, lastBotResponse, GLOBAL_COOLDOWN) {
    const sender = m.key.participant || m.key.remoteJid;
    try {
        const mediaMessage = getMediaMessage(m.message);
        if (!mediaMessage) return lastBotResponse;
        const isVideo = !!mediaMessage.videoMessage;
        const isAudio = !!mediaMessage.audioMessage;
        const originalCaption = mediaMessage.imageMessage?.caption || mediaMessage.videoMessage?.caption || '';
        
        lastBotResponse = await react(sock, m, '👀', lastBotResponse, GLOBAL_COOLDOWN);
        
        const buffer = await downloadMediaMessage({ key: m.key, message: mediaMessage }, 'buffer', {}, { 
            logger: pino({ level: 'silent' }), 
            reuploadRequest: sock.updateMediaMessage 
        }).catch(() => null);
        
        if (!buffer) {
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const senderName = m.pushName || 'Usuário';
        let revealCaption = `🔓 *Mídia Revelada!* 🔓\n👤 *De:* ${senderName}${originalCaption ? `\n💬 *Legenda:* ${originalCaption}` : ''}`;
        const opts = { mentions: [sender], quoted: m };
        
        if (isAudio) await sock.sendMessage(from, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, opts);
        else if (isVideo) await sock.sendMessage(from, { video: buffer, caption: revealCaption }, opts);
        else await sock.sendMessage(from, { image: buffer, caption: revealCaption }, opts);
        
        return await react(sock, m, '🔓', lastBotResponse, GLOBAL_COOLDOWN);
    } catch (error) { 
        return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN); 
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
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }
        
        const isSticker = !!mediaMessage.stickerMessage;
        const isViewOnceMsg = isViewOnce(targetMsg.message);
        
        lastBotResponse = await react(sock, m, '⏳', lastBotResponse, GLOBAL_COOLDOWN);

        if (isViewOnceMsg && action !== 'reveal') {
            lastBotResponse = await revealViewOnce(sock, from, targetMsg, lastBotResponse, GLOBAL_COOLDOWN);
        }

        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, { 
            logger: pino({ level: 'silent' }), 
            reuploadRequest: sock.updateMediaMessage 
        });
        
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
                const stickerBuffer = await mediaToSticker(buffer, mediaMessage.imageMessage?.mimetype || mediaMessage.videoMessage?.mimetype || '', requesterName, `${botName}`);
                await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: m });
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
        
        return await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
    } catch (error) { 
        return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN); 
    }
}

module.exports = { revealViewOnce, handleMediaCommand };
