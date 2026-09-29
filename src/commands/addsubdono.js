module.exports = {
    name: 'addsubdono',
    aliases: ['addsubowner', 'adicionarsubdono', 'setsubdono'],
    category: 'admin',
    description: 'Autoriza um número como sub-dono (pode usar !set/!config e !ativar/!desativar). Só o dono real.',
    async execute(sock, m, { from, isGroup, sender, args, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode adicionar sub-donos.' }, { quoted: m });
        }

        // Extrai candidato: prioriza dígitos digitados (à prova de @lid).
        // Menção (@) ou citação em grupo com privacidade LID resolve para ID
        // opaco — gravar isso no subOwners quebra o match depois. Por isso:
        // 1) se o texto tem dígitos, usa os dígitos; 2) menção @lid é rejeitada.
        let candidate = null;
        let mentionedRaw = null;
        try {
            const ctx = m.message?.extendedTextMessage?.contextInfo || utils.getContextInfo?.(m.message) || {};
            if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length > 0) {
                mentionedRaw = ctx.mentionedJid[0];
            } else if (ctx.participant) {
                mentionedRaw = ctx.participant;
            }
        } catch (_) {}
        if (fullArgsText) {
            const fromText = utils.extractPhoneFromText
                ? utils.extractPhoneFromText(fullArgsText)
                : String(fullArgsText).replace(/\D/g, '');
            if (fromText) candidate = fromText;
        }
        if (!candidate && Array.isArray(args)) {
            for (const a of args) {
                const d = utils.normalizePhoneNumber ? utils.normalizePhoneNumber(a, { min: 10 }) : String(a).replace(/\D/g, '');
                if (d) { candidate = d; break; }
            }
        }
        if (!candidate && mentionedRaw) {
            if (String(mentionedRaw).endsWith('@lid')) {
                return await sock.sendMessage(from, { text: '❌ Não consegui identificar o número (menção @lid sem telefone visível).\n\n💡 Use: !addsubdono 5598989138217 (digite o número com DDI+DDD).' }, { quoted: m });
            }
            candidate = mentionedRaw;
        }

        if (!candidate) {
            return await sock.sendMessage(from, { text: '❌ Use: !addsubdono 5598989138217\n\n💡 Você também pode marcar (@) ou responder a mensagem da pessoa.' }, { quoted: m });
        }

        const phone = utils.normalizePhoneNumber(String(candidate).split('@')[0] || candidate);
        if (!phone) {
            return await sock.sendMessage(from, { text: '❌ Número inválido. Use: !addsubdono 5598989138217' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '➕', lastBotResponse, GLOBAL_COOLDOWN);

        const res = utils.addSubOwner(phone);
        if (!res.ok) {
            if (res.error === 'duplicado') {
                await sock.sendMessage(from, { text: `ℹ️ O número *${phone}* já é sub-dono.` }, { quoted: m });
                return await react(sock, m, '⚠️', currentBotResponse, GLOBAL_COOLDOWN);
            }
            await sock.sendMessage(from, { text: `❌ Falha ao adicionar: ${res.error}` }, { quoted: m });
            return await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        await sock.sendMessage(from, { text: `✅ Número *${res.phone}* agora é *sub-dono*! 👑\n\nEle já pode configurar variáveis do bot (*!set*, *!config*) e ativar/desativar o bot (*!ativar*, *!ativarp*, *!desativar*).\n💡 Veja a lista com *!listsubdonos* • remova com *!remsubdono ${res.phone}*` }, { quoted: m });
        return await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
    }
};
