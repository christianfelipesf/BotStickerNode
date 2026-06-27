const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = {
    name: 'transmitir',
    aliases: ['broadcast', 'transmitirgrupos'],
    category: 'admin',
    description: 'Transmite mensagem/mídia para todos os grupos ativos',
    async execute(sock, m, { from, sender, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, listActiveGroups, getMediaMessage, getMessageText } = utils;
        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });

        const targets = listActiveGroups().filter(j => j.endsWith('@g.us'));
        if (!targets.length) return sock.sendMessage(from, { text: '❌ Nenhum grupo ativo para transmitir.' }, { quoted: m });

        let text = fullArgsText.trim();
        const quotedInfo = m.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = quotedInfo?.quotedMessage;
        let mediaBuf = null, mediaType = null, mimeType = null, mediaFailed = false;

        // Tenta obter mídia: primeiro de mensagem respondida, depois da própria mensagem
        let media = quotedMsg ? getMediaMessage(quotedMsg) : null;
        let downloadKey = null;

        if (!media) {
            media = getMediaMessage(m.message);
            if (media) downloadKey = m.key;
        } else if (quotedInfo) {
            const quotedSender = quotedInfo.participant || from;
            const isFromMe = utils.normalizeJid(quotedSender) === utils.normalizeJid(sock.user.id);
            downloadKey = { remoteJid: from, id: quotedInfo.stanzaId, participant: quotedSender, fromMe: isFromMe };
        }

        if (media) {
            const mediaKey = Object.keys(media).find(k => k.endsWith('Message'));
            if (mediaKey && downloadKey) {
                mediaType = mediaKey.replace('Message', '');
                mimeType = media[mediaKey]?.mimetype || '';
                try {
                    mediaBuf = await downloadMediaMessage(
                        { key: downloadKey, message: media },
                        'buffer', {},
                        { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                    );
                } catch (e) {
                    console.error('[transmitir] download media error:', e.message);
                    mediaFailed = true;
                }
            }
            if (!text) text = media[mediaKey]?.caption || '';
        }

        if (!text && !mediaBuf && quotedMsg) text = getMessageText(quotedMsg) || '';
        if (!text && !mediaBuf) return sock.sendMessage(from, { text: '❌ Use: !transmitir <mensagem> ou envie/responda uma mídia' }, { quoted: m });

        let success = 0, fail = 0;
        let currentBotResponse = await react(sock, m, '📡', lastBotResponse, GLOBAL_COOLDOWN);
        await sock.sendMessage(from, { text: `📡 Transmitindo para ${targets.length} grupo(s)...` }, { quoted: m });

        for (const jid of targets) {
            try {
                const payload = mediaBuf
                    ? { [mediaType]: mediaBuf, mimetype: mimeType, caption: text || undefined }
                    : { text };
                await sock.sendMessage(jid, payload);
                success++;
            } catch (e) {
                fail++;
                console.log(`❌ [transmitir] Falha ao enviar para ${jid}:`, e.message);
            }
            await sleep(1200);
        }

        let resultMsg = `✅ Transmissão concluída: ${success} sucesso(s), ${fail} falha(s)`;
        if (mediaFailed) resultMsg += `\n⚠️ Mídia não pôde ser baixada, apenas o texto foi transmitido`;
        await sock.sendMessage(from, { text: resultMsg }, { quoted: m });
        return currentBotResponse;
    }
};
