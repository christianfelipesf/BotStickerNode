const { getInteractionVideoMedia, getInteractionDir } = require('./interaction');

// Extrai contextInfo de qualquer tipo de mensagem (texto, imagem, vídeo, etc.)
function getContextInfo(m) {
    const msg = m?.message || {};
    return (
        msg.extendedTextMessage?.contextInfo ||
        msg.imageMessage?.contextInfo ||
        msg.videoMessage?.contextInfo ||
        msg.stickerMessage?.contextInfo ||
        msg.documentMessage?.contextInfo ||
        msg.audioMessage?.contextInfo ||
        null
    );
}

function createInteractionCommand({ name, aliases, category = 'interação', description, emoji, captionVerb, endpointKey, selfMessage }) {
    const cmdName = name;
    const key = endpointKey || name;
    return {
        name: cmdName,
        aliases,
        category,
        description,
        async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN, log }) {
            const { react } = utils;
            const say = (...a) => { try { if (typeof log === 'function') log(...a); } catch (_) {} };
            let current = await react(sock, m, emoji, lastBotResponse, GLOBAL_COOLDOWN);
            try {
                const ctx = getContextInfo(m);
                const mentionedJid = ctx?.mentionedJid?.[0] || null;
                const quotedParticipant = ctx?.participant || null;
                let targetJid = mentionedJid || quotedParticipant || null;
                if (!targetJid) {
                    await sock.sendMessage(from, { text: `❌ Marque alguém: \`!${cmdName} @user\` ou responda a mensagem da pessoa com \`!${cmdName}\`.` }, { quoted: m });
                    return current;
                }
                if (targetJid === sender) {
                    const msg = selfMessage || `😅 Você não pode usar !${cmdName} em si mesmo! Marque outra pessoa.`;
                    await sock.sendMessage(from, { text: msg }, { quoted: m });
                    return current;
                }
                let media = null;
                try { media = await getInteractionVideoMedia(key); } catch (e) { console.error(`❌ [${cmdName}] mídia local falhou:`, e.message); say('mídia falhou', e.message); }
                if (!media) {
                    console.warn(`⚠️ [${cmdName}] pasta vazia: coloque um .gif/.mp4 em ${getInteractionDir(key)}`);
                    say('pasta vazia', getInteractionDir(key));
                } else {
                    say('mídia', `${media.ext} ${Math.round(media.buffer.length / 1024)}KB`);
                }

                const isLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid');
                const isGenericName = (n) => !n || ['usuario', 'usuário'].includes(String(n).trim().toLowerCase());
                const cleanName = (n) => String(n).trim().slice(0, 30);

                // Tenta resolver um display bonito e um JID mencionável.
                // Para @lid busca o número real via groupMetadata ou groupMentions/participantPn.
                async function resolveMention(jid, fallbackName) {
                    if (!jid) return { text: '*Usuário*', jid: null, hasMention: false };
                    // JID normal (@s.whatsapp.net)
                    if (!isLid(jid)) {
                        const ph = String(jid).split('@')[0].split(':')[0];
                        if (/^\d{8,15}$/.test(ph)) return { text: `@${ph}`, jid, hasMention: true };
                        if (fallbackName && !isGenericName(fallbackName)) return { text: `*${cleanName(fallbackName)}*`, jid, hasMention: false };
                        return { text: '*Usuário*', jid: null, hasMention: false };
                    }
                    // JID é @lid — precisa mencionar via LID para funcionar em grupos com privacidade
                    const lidPart = String(jid).split('@')[0]; // ex: 123456:12
                    // Texto de menção deve conter @<lidPart> e mentions deve conter o LID
                    const mentionText = `@${lidPart}`;
                    // Tenta manter jid como LID (correto para notificação). Se tivermos PN, não troca jid, só usa para fallback visual se necessário.
                    // A menção com @lidPart já é suficiente; WhatsApp resolve para o nome do contato no client.
                    return { text: mentionText, jid, hasMention: true };
                }

                // fallbacks de nome (usado apenas para JIDs não-mencionáveis)
                const senderFallback = m.pushName || null;
                let targetFallback = null;
                try {
                    targetFallback = await utils.getGroupParticipantName(sock, from, targetJid, null).catch(() => null);
                    if (isGenericName(targetFallback)) targetFallback = null;
                } catch (_) {}
                if (!targetFallback) targetFallback = ctx?.pushName || null;

                const senderDisp = await resolveMention(sender, senderFallback);
                const targetDisp = await resolveMention(targetJid, targetFallback);

                const caption = `${emoji} ${senderDisp.text} ${captionVerb} ${targetDisp.text}`;
                const mentions = [senderDisp.jid, targetDisp.jid].filter(Boolean);
                if (media) {
                    // 1) MP4 (ou gif convertido): vídeo com gifPlayback — único formato animado que o WhatsApp aceita
                    if (media.ext === '.mp4') {
                        try {
                            await sock.sendMessage(from, { video: media.buffer, mimetype: 'video/mp4', gifPlayback: true, caption, mentions }, { quoted: m });
                            return current;
                        } catch (e) {
                            console.error(`❌ [${cmdName}] envio video falhou, tentando documento:`, e.message);
                            say('video falhou', e.message);
                        }
                    }
                    // 2) GIF original (sem ffmpeg) ou imagem: envia como documento (entrega garantida)
                    if (media.ext === '.gif') {
                        try {
                            await sock.sendMessage(from, { document: media.buffer, mimetype: 'image/gif', fileName: `${key}.gif`, caption, mentions }, { quoted: m });
                            return current;
                        } catch (e) {
                            console.error(`❌ [${cmdName}] envio documento falhou, tentando imagem:`, e.message);
                            say('documento falhou', e.message);
                        }
                    }
                    // 3) Imagem estática
                    try {
                        await sock.sendMessage(from, { image: media.buffer, caption, mentions }, { quoted: m });
                        return current;
                    } catch (e) {
                        console.error(`❌ [${cmdName}] envio imagem falhou, enviando só texto:`, e.message);
                        say('imagem falhou', e.message);
                    }
                }
                await sock.sendMessage(from, { text: caption, mentions }, { quoted: m });
                return current;
            } catch (e) {
                console.error(`❌ [${cmdName}] erro:`, e.message);
                await sock.sendMessage(from, { text: `❌ Falha ao executar !${cmdName}.` }, { quoted: m });
                return current;
            }
        }
    };
}

module.exports = { createInteractionCommand };
