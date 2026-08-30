const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

module.exports = {
    name: 'rename',
    aliases: ['renomear', 'setpack', 'pack', 'autor'],
    category: 'mídia',
    description: 'Renomeia sticker marcado (pack/autor)',
    async execute(sock, m, { from, fullArgsText, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getMediaMessage, addMetadata } = utils;

        const effectivePrefix = config.prefix || '!';

        const clean = (s) => String(s || '').trim().replace(/[\n\r]/g, ' ').slice(0, 30);

        // Verifica se tem sticker marcado
        const quotedInfo = m.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = quotedInfo?.quotedMessage;

        if (!quotedMsg) {
            await sock.sendMessage(from, { text: `❌ Marque um sticker com *${effectivePrefix}rename pack/autor*\n\n💡 Ex: responda um sticker com \`${effectivePrefix}rename MeuPack/MeuAutor\` ou \`${effectivePrefix}rename Meu Pack | Meu Autor\`` }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const mediaMessage = getMediaMessage(quotedMsg);
        if (!mediaMessage || !mediaMessage.stickerMessage) {
            await sock.sendMessage(from, { text: `❌ Marque apenas *stickers*.\n\n💡 Responda um sticker com \`${effectivePrefix}rename pack/autor\`` }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        if (!fullArgsText || !fullArgsText.trim()) {
            const help = `🏷️ *Rename — Sticker atual*\n\n` +
                `💡 *Uso:* responda um sticker com\n` +
                `   ${effectivePrefix}rename pack/autor\n` +
                `   ${effectivePrefix}rename Meu Pack | Meu Autor\n\n` +
                `• Separe com \`/\` ou \`|\`\n` +
                `• Ex: \`${effectivePrefix}rename BotStickerNode/Bot\`\n` +
                `• Só altera o sticker marcado, não salva para os próximos.`;
            await sock.sendMessage(from, { text: help }, { quoted: m });
            return lastBotResponse;
        }

        const raw = String(fullArgsText).trim();

        // Parse pack / author — suporta / ou |
        let pack = null;
        let author = null;
        let sep = null;
        if (raw.includes('/')) sep = '/';
        else if (raw.includes('|')) sep = '|';

        if (sep) {
            const parts = raw.split(sep);
            const p1 = parts[0] || '';
            const p2 = parts.slice(1).join(sep) || '';
            pack = clean(p1);
            author = clean(p2);
        } else {
            await sock.sendMessage(from, { text: `❌ Formato inválido. Use: \`${effectivePrefix}rename pack/autor\` ou \`${effectivePrefix}rename pack | autor\`` }, { quoted: m });
            return lastBotResponse;
        }

        if (!pack || !author) {
            await sock.sendMessage(from, { text: `❌ Informe pack e autor. Ex: \`${effectivePrefix}rename MeuPack/MeuAutor\`` }, { quoted: m });
            return lastBotResponse;
        }

        if (pack.length < 1 || pack.length > 30 || author.length < 1 || author.length > 30) {
            await sock.sendMessage(from, { text: '❌ Pack e autor devem ter entre 1 e 30 caracteres.' }, { quoted: m });
            return lastBotResponse;
        }

        // Baixa sticker marcado
        let quotedBuffer = null;
        try {
            const targetMsg = {
                key: { remoteJid: from, id: quotedInfo.stanzaId, participant: quotedInfo.participant || from },
                message: mediaMessage
            };
            quotedBuffer = await downloadMediaMessage(targetMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
        } catch (e) {
            quotedBuffer = null;
        }

        if (!quotedBuffer || quotedBuffer.length < 64) {
            await sock.sendMessage(from, { text: '❌ Não foi possível baixar o sticker marcado. Tente novamente.' }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        try {
            await react(sock, m, '⏳', lastBotResponse, GLOBAL_COOLDOWN);
            const renamed = await addMetadata(quotedBuffer, pack, author);
            if (!renamed || renamed.length < 64) throw new Error('Falha ao gerar sticker renomeado');
            await sock.sendMessage(from, { sticker: renamed }, { quoted: m });
            return await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
        } catch (e) {
            console.error('❌ [RENAME] falha:', e.message);
            await sock.sendMessage(from, { text: '❌ Falha ao renomear o sticker. Tente outro sticker.' }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }
    }
};
