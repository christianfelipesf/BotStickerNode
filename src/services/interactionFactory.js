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
                // Baileys expõe PN alternativo quando o JID é @lid
                const quotedPn = ctx?.participantPn || null;
                const senderPn = m.key?.participantPn || m.key?.senderPn || null;
                const groupMentions = Array.isArray(ctx?.groupMentions) ? ctx.groupMentions : [];
                let targetJid = mentionedJid || quotedParticipant || null;
                const isQuotedTarget = !mentionedJid && !!quotedParticipant;
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
                    if (!jid) return { text: '*Usuário*', jid: null };
                    // Se for LID, tenta achar o @s.whatsapp.net correspondente
                    if (isLid(jid)) {
                        // 1) groupMentions traz mapeamento lid->pn
                        try {
                            const gm = groupMentions.find(g => g.jid === jid || g.lid === jid);
                            const pn = gm?.jid || gm?.pn || gm?.phoneNumber || null;
                            if (pn && String(pn).endsWith('@s.whatsapp.net')) {
                                const ph = String(pn).split('@')[0].split(':')[0];
                                if (/^\d{8,15}$/.test(ph)) return { text: `@${ph}`, jid: pn };
                            }
                        } catch (_) {}
                        // 2) groupMetadata participants (id/lid)
                        if (isGroup && sock && from) {
                            try {
                                const meta = await utils.groupMetadataCached(sock, from);
                                const p = meta?.participants?.find(x => x.lid === jid || x.id === jid);
                                if (p) {
                                    if (p.id && String(p.id).endsWith('@s.whatsapp.net')) {
                                        const ph = String(p.id).split('@')[0].split(':')[0];
                                        if (/^\d{8,15}$/.test(ph)) return { text: `@${ph}`, jid: p.id };
                                    }
                                    if (p.phoneNumber && String(p.phoneNumber).endsWith('@s.whatsapp.net')) {
                                        const ph = String(p.phoneNumber).split('@')[0].split(':')[0];
                                        if (/^\d{8,15}$/.test(ph)) return { text: `@${ph}`, jid: String(p.phoneNumber) };
                                    }
                                    const n = p.notify || p.name || p.verifiedName || null;
                                    if (n && !isGenericName(n)) return { text: `*${cleanName(n)}*`, jid };
                                }
                            } catch (_) {}
                            // tenta cache de activity (nome salvo)
                            try {
                                const cached = utils.getCachedParticipantName ? utils.getCachedParticipantName(from, jid) : null;
                                if (cached && !isGenericName(cached)) return { text: `*${cleanName(cached)}*`, jid };
                            } catch (_) {}
                            // tenta getGroupParticipantName (assíncrono, busca metadata)
                            try {
                                const fetched = await utils.getGroupParticipantName(sock, from, jid, fallbackName);
                                if (fetched && !isGenericName(fetched) && fetched !== 'Usuário') return { text: `*${cleanName(fetched)}*`, jid };
                            } catch (_) {}
                        }
                        if (fallbackName && !isGenericName(fallbackName)) return { text: `*${cleanName(fallbackName)}*`, jid };
                        return { text: '*Usuário*', jid };
                    }
                    // JID normal
                    const ph = String(jid).split('@')[0].split(':')[0];
                    if (/^\d{8,15}$/.test(ph)) return { text: `@${ph}`, jid };
                    if (fallbackName && !isGenericName(fallbackName)) return { text: `*${cleanName(fallbackName)}*`, jid };
                    return { text: '*Usuário*', jid };
                }

                // fallbacks de nome
                const senderFallback = m.pushName || null;
                let effectiveSenderJid = sender;
                if (isLid(sender)) {
                    const senderPn = m.key?.participantPn || m.key?.senderPn || null;
                    if (senderPn && String(senderPn).endsWith('@s.whatsapp.net')) {
                        const ph = String(senderPn).split('@')[0].split(':')[0];
                        if (/^\d{8,15}$/.test(ph)) effectiveSenderJid = String(senderPn);
                    }
                }
                // target fallback: tenta várias fontes (pushName do contexto não existe, então busca via utils)
                let targetFallback = null;
                try {
                    // participantPn do quote pode ser o número real do alvo
                    if (isQuotedTarget && isLid(targetJid) && quotedPn && String(quotedPn).endsWith('@s.whatsapp.net')) {
                        const ph = String(quotedPn).split('@')[0].split(':')[0];
                        if (/^\d{8,15}$/.test(ph)) {
                            targetJid = String(quotedPn);
                        }
                    }
                    targetFallback = await utils.getGroupParticipantName(sock, from, targetJid, null).catch(() => null);
                    if (isGenericName(targetFallback)) targetFallback = null;
                } catch (_) {}
                if (!targetFallback) targetFallback = ctx?.pushName || null; // último recurso (raro existir)

                const senderDisp = await resolveMention(effectiveSenderJid, senderFallback);
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
