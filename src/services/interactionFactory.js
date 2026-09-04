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
                const isLid = (jid)=> typeof jid==='string' && jid.endsWith('@lid');
                const disp = (jid, fallbackName)=>{
                    if(isLid(jid)) return fallbackName && !['usuario','usuário'].includes(String(fallbackName).trim().toLowerCase()) ? `*${String(fallbackName).trim().slice(0,30)}*` : `*Usuário*`;
                    const ph=String(jid||'').split('@')[0].split(':')[0];
                    return /^\d{8,15}$/.test(ph) ? `*@${ph}*` : (fallbackName ? `*${String(fallbackName).trim().slice(0,30)}*` : `*Usuário*`);
                };
                const senderNameDisp = m.pushName || null;
                const targetNameDisp = ctx?.pushName || null;
                const caption = `${emoji} ${disp(sender, senderNameDisp)} ${captionVerb} ${disp(targetJid, targetNameDisp)}`;
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
