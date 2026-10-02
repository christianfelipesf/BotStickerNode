module.exports = {
    name: 'addguardiao',
    aliases: ['addguardian', 'adicionarguardiao', 'setguardiao'],
    category: 'admin',
    description: 'Autoriza um número como guardião (só !ativar/!desativar/!ativarp/!desativarp, !news e !aidono). Dono e sub-donos.',
    async execute(sock, m, { from, sender, args, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const access = typeof utils.canConfigureBot === 'function'
            ? utils.canConfigureBot(sock, m, sender, from)
            : { ok: false };
        if (!access.ok) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono ou sub-donos podem adicionar guardiões.' }, { quoted: m });
        }

        // Extrai candidato: prioriza dígitos digitados (à prova de @lid).
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
                return await sock.sendMessage(from, { text: '❌ Não consegui identificar o número (menção @lid sem telefone visível).\n\n💡 Use: !addguardiao 5598989138217 (digite o número com DDI+DDD).' }, { quoted: m });
            }
            candidate = mentionedRaw;
        }

        if (!candidate) {
            return await sock.sendMessage(from, { text: '❌ Use: !addguardiao 5598989138217\n\n💡 Você também pode marcar (@) ou responder a mensagem da pessoa.' }, { quoted: m });
        }

        const phone = utils.normalizePhoneNumber(String(candidate).split('@')[0] || candidate);
        if (!phone) {
            return await sock.sendMessage(from, { text: '❌ Número inválido. Use: !addguardiao 5598989138217' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '➕', lastBotResponse, GLOBAL_COOLDOWN);

        const res = utils.addGuardiao(phone);
        if (!res.ok) {
            if (res.error === 'duplicado') {
                await sock.sendMessage(from, { text: `ℹ️ O número *${phone}* já é guardião.` }, { quoted: m });
                return await react(sock, m, '⚠️', currentBotResponse, GLOBAL_COOLDOWN);
            }
            await sock.sendMessage(from, { text: `❌ Falha ao adicionar: ${res.error}` }, { quoted: m });
            return await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        await sock.sendMessage(from, { text: `✅ Número *${res.phone}* agora é *guardião*! 🛡️\n\nEle pode: *!ativar*, *!desativar*, *!ativarp*, *!desativarp*, *!news ativar/desativar* e *!aidono*.\n⛔ NÃO pode mexer em configs, chaves API nem gerenciar sub-donos/gardiões.\n💡 Veja a lista com *!listguardioes* • remova com *!remguardiao ${res.phone}*` }, { quoted: m });
        return await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
    }
};
