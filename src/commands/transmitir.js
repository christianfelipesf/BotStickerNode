const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

const CONFIRM_TIMEOUT = 5 * 60 * 1000;
const pendingConfirmations = new Map(); // `${sender}:${from}` -> { text, mediaBuf, mediaType, mimeType }

async function buildPayloadFromMsg(sock, m, from, fullArgsText, utils) {
    const { getMediaMessage, getMessageText } = utils;
    let text = (fullArgsText || '').trim();
    // "confirmar" não é conteúdo
    if (text.toLowerCase() === 'confirmar') text = '';
    const quotedInfo = m.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = quotedInfo?.quotedMessage;
    let mediaBuf = null, mediaType = null, mimeType = null, mediaFailed = false;

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
    return { text, mediaBuf, mediaType, mimeType, mediaFailed };
}

module.exports = {
    name: 'transmitir',
    aliases: ['broadcast', 'transmitirgrupos'],
    category: 'admin',
    description: 'Transmite mensagem/mídia para todos os grupos ativos (com confirmação anti-ban)',
    async execute(sock, m, { from, sender, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN, cancelToken }) {
        const { react, listActiveGroups } = utils;
        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });

        const targets = listActiveGroups().filter(j => j.endsWith('@g.us'));
        if (!targets.length) return sock.sendMessage(from, { text: '❌ Nenhum grupo ativo para transmitir.' }, { quoted: m });

        const key = `${sender}:${from}`;
        const arg0 = String((fullArgsText || '').trim().split(/\s+/)[0] || '').toLowerCase();

        // 2º passo: confirmação
        if (arg0 === 'confirmar') {
            const pend = pendingConfirmations.get(key);
            if (!pend || Date.now() > pend.expiresAt) return sock.sendMessage(from, { text: '⚠️ Nada pendente. Use `!transmitir <mensagem>` primeiro.' }, { quoted: m });
            pendingConfirmations.delete(key);
            const safe = require('../services/safeBroadcast');
            const cfg = utils.readConfig();
            if (safe.isBroadcastRunning()) return sock.sendMessage(from, { text: '⏳ Já existe um broadcast em andamento. Aguarde.' }, { quoted: m });
            await react(sock, m, '📡', lastBotResponse, GLOBAL_COOLDOWN).catch(() => {});
            await sock.sendMessage(from, { text: `📡 Transmitindo devagar para ${targets.length} grupo(s) (anti-ban)...` }, { quoted: m });
            const res = await safe.runSafeBroadcast(sock, targets, () => (
                pend.mediaBuf
                    ? { [pend.mediaType]: pend.mediaBuf, mimetype: pend.mimeType, caption: pend.text || undefined }
                    : { text: pend.text }
            ), { cfg, cancelToken });
            let msg = `✅ Transmissão concluída: ${res.sent} sucesso(s), ${res.failed} falha(s)`;
            if (pend.mediaFailed) msg += `\n⚠️ Mídia não pôde ser baixada, apenas o texto foi transmitido`;
            if (res.stopped) msg += `\n⛔ Parado: ${res.stopped}`;
            await sock.sendMessage(from, { text: msg }, { quoted: m });
            return lastBotResponse;
        }

        const built = await buildPayloadFromMsg(sock, m, from, fullArgsText, utils);
        if (!built.text && !built.mediaBuf) return sock.sendMessage(from, { text: '❌ Use: !transmitir <mensagem> ou envie/responda uma mídia' }, { quoted: m });

        const safe = require('../services/safeBroadcast');
        const cfg = utils.readConfig();
        pendingConfirmations.set(key, { ...built, expiresAt: Date.now() + CONFIRM_TIMEOUT });
        setTimeout(() => { if (pendingConfirmations.get(key)?.expiresAt <= Date.now()) pendingConfirmations.delete(key); }, CONFIRM_TIMEOUT + 5000).unref?.();
        return sock.sendMessage(from, {
            text: `⚠️ *CONFIRMAR TRANSMISSÃO*\n\n` +
                `📢 ${targets.length} grupo(s) • ~${safe.formatEta(safe.estimateTotal(targets.length, cfg))}\n` +
                `❗ Envio idêntico e rápido causa *ban temporário*. O bot envia devagar e para sozinho em rate-limit.\n\n` +
                `Confirme com \`!transmitir confirmar\` (5 min).`
        }, { quoted: m });
    }
};
