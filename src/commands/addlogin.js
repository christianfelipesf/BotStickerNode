module.exports = {
    name: 'addlogin',
    aliases: ['addlogins', 'adicionarlogin'],
    category: 'admin',
    description: 'Autoriza um número do privado a usar !login (sub-sessão). Só o dono, só no privado.',
    async execute(sock, m, { from, isGroup, sender, args, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        if (isGroup) {
            return await sock.sendMessage(from, { text: '❌ Use este comando apenas no privado do bot.' }, { quoted: m });
        }

        // Extrai candidato: menção, citação ou dígitos digitados
        let candidate = null;
        try {
            const ctx = m.message?.extendedTextMessage?.contextInfo || utils.getContextInfo?.(m.message) || {};
            if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length > 0) {
                candidate = ctx.mentionedJid[0];
            } else if (ctx.participant) {
                candidate = ctx.participant;
            }
        } catch (_) {}
        if (!candidate && fullArgsText) {
            const matches = String(fullArgsText).match(/\d{8,15}/g);
            if (matches && matches.length > 0) candidate = matches[0];
        }
        if (!candidate && Array.isArray(args)) {
            for (const a of args) {
                const d = String(a).replace(/\D/g, '');
                if (d.length >= 8 && d.length <= 15) { candidate = d; break; }
            }
        }
        // Sem número: usa o contato do privado atual automaticamente
        if (!candidate && !isGroup && from && !String(from).endsWith('@g.us') && !String(from).endsWith('@lid')) {
            candidate = from;
        }

        if (!candidate) {
            return await sock.sendMessage(from, { text: '❌ Use: !addlogin 5511999999999\n\n💡 No privado, basta digitar *!addlogin* sem número para autorizar o contato da conversa.\nVocê também pode marcar (@) ou responder a mensagem da pessoa.' }, { quoted: m });
        }

        const phone = utils.normalizeLoginPhone(String(candidate).split('@')[0] || candidate);
        if (!phone) {
            return await sock.sendMessage(from, { text: '❌ Número inválido. Use: !addlogin 5511999999999' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '➕', lastBotResponse, GLOBAL_COOLDOWN);

        const res = utils.addLoginAllowed(phone, sender);
        if (!res.ok) {
            if (res.error === 'duplicado') {
                await sock.sendMessage(from, { text: `ℹ️ O número *${phone}* já está autorizado a usar !login.` }, { quoted: m });
                return await react(sock, m, '⚠️', currentBotResponse, GLOBAL_COOLDOWN);
            }
            await sock.sendMessage(from, { text: `❌ Falha ao autorizar: ${res.error}` }, { quoted: m });
            return await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        await sock.sendMessage(from, { text: `✅ Número *${res.phone}* autorizado!\n\nEle já pode usar *!login* no privado do bot sem ser dono.\n💡 Veja a lista com *!listalogins* • remova com *!removerlogin ${res.phone}*` }, { quoted: m });
        return await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
    }
};
