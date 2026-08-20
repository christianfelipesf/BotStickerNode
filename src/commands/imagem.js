const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

module.exports = {
    name: 'imagem',
    aliases: ['setimg', 'setmenu'],
    category: 'grupos',
    description: 'Altera a imagem do menu neste grupo',
    async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getMediaMessage, saveGroupMenuImage, getAdmins, isUserAdmin, normalizeJid } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        let allowed = isBotOwner;
        if (!allowed) {
            try { const admins = await getAdmins(sock, from); allowed = isUserAdmin(sender, admins); } catch (_) {}
        }
        if (!allowed) {
            await sock.sendMessage(from, { text: '❌ Apenas admins podem alterar a imagem do menu.' }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }
        
        let imgMedia = null;
        const quotedImageInfo = m.message.extendedTextMessage?.contextInfo;
        const quotedImageMsg = quotedImageInfo?.quotedMessage;
        
        if (quotedImageMsg) imgMedia = getMediaMessage(quotedImageMsg);
        else imgMedia = getMediaMessage(m.message);

        if (!imgMedia || !imgMedia.imageMessage) {
            await sock.sendMessage(from, { text: '❌ Marque ou envie uma imagem.' }, { quoted: m });
            return lastBotResponse;
        }
        
        let currentBotResponse = await react(sock, m, '⏳', lastBotResponse, GLOBAL_COOLDOWN);
        try {
            const targetKey = quotedImageMsg ? { 
                remoteJid: from, 
                id: quotedImageInfo.stanzaId, 
                participant: quotedImageInfo.participant || from 
            } : m.key;
            
            const imgBuffer = await downloadMediaMessage(
                { key: targetKey, message: imgMedia }, 
                'buffer', 
                {}, 
                { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
            );
            
            if (!imgBuffer) throw new Error('Buffer vazio');
            
            await saveGroupMenuImage(from, imgBuffer);
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, { text: '✅ Imagem do menu atualizada para este grupo!' }, { quoted: m });
        } catch (e) {
            console.error('Erro ao salvar imagem do grupo:', e);
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }
        
        return currentBotResponse;
    }
};
