const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');

const CONFIRM_TIMEOUT = 5 * 60 * 1000;
const pendingConfirmations = new Map();

async function buildPayloadFromMsg(sock, m, from, fullArgsText, utils) {
    const { getMediaMessage, getMessageText } = utils;
    let text = (fullArgsText || '').trim();
    if (text.toLowerCase() === 'confirmar') text = '';
    const quotedInfo = m.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = quotedInfo?.quotedMessage;
    let mediaBuf = null, mediaType = null, mimeType = null;

    let media = quotedMsg ? getMediaMessage(quotedMsg) : null;
    let downloadKey = null;
    if (!media) {
        media = getMediaMessage(m.message);
        if (media) downloadKey = m.key;
    } else if (quotedInfo) {
        downloadKey = { remoteJid: from, id: quotedInfo.stanzaId, participant: quotedInfo.participant || from };
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
                console.error('[transmitirall] download media error:', e.message);
            }
        }
        if (!text) text = media[mediaKey]?.caption || '';
    }
    if (!text && !mediaBuf && quotedMsg) text = getMessageText(quotedMsg) || '';
    return { text, mediaBuf, mediaType, mimeType };
}

module.exports = {
    name: 'transmitirall',
    aliases: ['broadcastall'],
    category: 'admin',
    description: 'Transmite para ativos + parciais (com confirmação anti-ban)',
    async execute(sock, m, { from, sender, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN, cancelToken }) {
        const { react, listActiveGroups, listPartialGroups } = utils;
        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });

        const active = listActiveGroups().filter(j => j.endsWith('@g.us'));
        const partial = listPartialGroups().filter(j => j.endsWith('@g.us'));
        const targets = [...new Set([...active, ...partial])];
        if (!targets.length) return sock.sendMessage(from, { text: '❌ Nenhum grupo ativo ou parcialmente ativo para transmitir.' }, { quoted: m });

        const key = `${sender}:${from}`;
        const arg0 = String((fullArgsText || '').trim().split(/\s+/)[0] || '').toLowerCase();

        if (arg0 === 'confirmar') {
            const pend = pendingConfirmations.get(key);
            if (!pend || Date.now() > pend.expiresAt) return sock.sendMessage(from, { text: '⚠️ Nada pendente. Use `!transmitirall <mensagem>` primeiro.' }, { quoted: m });
            pendingConfirmations.delete(key);
            const safe = require('../services/safeBroadcast');
            const cfg = utils.readConfig();
            if (safe.isBroadcastRunning()) return sock.sendMessage(from, { text: '⏳ Já existe um broadcast em andamento. Aguarde.' }, { quoted: m });
            await react(sock, m, '📡', lastBotResponse, GLOBAL_COOLDOWN).catch(() => {});
            await sock.sendMessage(from, { text: `📡 Transmitindo devagar para ${targets.length} grupo(s) (${active.length} ativos + ${partial.length} parciais)...` }, { quoted: m });
            let removed = 0;
            const res = await safe.runSafeBroadcast(sock, targets, () => (
                pend.mediaBuf
                    ? { [pend.mediaType]: pend.mediaBuf, mimetype: pend.mimeType, caption: pend.text || undefined }
                    : { text: pend.text }
            ), { cfg, cancelToken });
            const parts = [`✅ Transmissão concluída: ${res.sent} sucesso(s)`];
            if (res.failed) parts.push(`${res.failed} falha(s)`);
            if (removed) parts.push(`${removed} removido(s)`);
            if (res.stopped) parts.push(`⛔ ${res.stopped}`);
            await sock.sendMessage(from, { text: parts.join(', ') }, { quoted: m });
            return lastBotResponse;
        }

        const built = await buildPayloadFromMsg(sock, m, from, fullArgsText, utils);
        if (!built.text && !built.mediaBuf) return sock.sendMessage(from, { text: '❌ Use: !transmitirall <mensagem> ou envie/responda uma mídia' }, { quoted: m });

        const safe = require('../services/safeBroadcast');
        const cfg = utils.readConfig();
        pendingConfirmations.set(key, { ...built, expiresAt: Date.now() + CONFIRM_TIMEOUT });
        setTimeout(() => { if (pendingConfirmations.get(key)?.expiresAt <= Date.now()) pendingConfirmations.delete(key); }, CONFIRM_TIMEOUT + 5000).unref?.();
        return sock.sendMessage(from, {
            text: `⚠️ *CONFIRMAR TRANSMISSÃO ALL*\n\n` +
                `📢 ${targets.length} grupo(s) (${active.length} ativos + ${partial.length} parciais) • ~${safe.formatEta(safe.estimateTotal(targets.length, cfg))}\n` +
                `❗ Envio em massa idêntico causa *ban temporário*.\n\n` +
                `Confirme com \`!transmitirall confirmar\` (5 min).`
        }, { quoted: m });
    }
};
