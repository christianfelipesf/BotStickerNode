const { fetchInteractionImage } = require('./interaction');

function createInteractionCommand({ name, aliases, category = 'interação', description, emoji, captionVerb, endpointKey, selfMessage }) {
    const cmdName = name;
    const key = endpointKey || name;
    return {
        name: cmdName,
        aliases,
        category,
        description,
        async execute(sock, m, { from, isGroup, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
            const { react } = utils;
            let current = await react(sock, m, emoji, lastBotResponse, GLOBAL_COOLDOWN);
            try {
                const ctx = m.message.extendedTextMessage?.contextInfo;
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
                let buffer = null;
                try { buffer = await fetchInteractionImage(key); } catch (e) { console.error(`❌ [${cmdName}] fetch falhou:`, e.message); }

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
                if (buffer) await sock.sendMessage(from, { image: buffer, caption, mentions }, { quoted: m });
                else await sock.sendMessage(from, { text: caption, mentions }, { quoted: m });
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
