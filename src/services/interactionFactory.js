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
                const targetJid = mentionedJid || quotedParticipant || null;
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
                const caption = `${emoji} *@${sender.split('@')[0]}* ${captionVerb} *@${targetJid.split('@')[0]}*`;
                const mentions = [sender, targetJid];
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
