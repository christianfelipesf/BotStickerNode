module.exports = {
    name: 'cita',
    aliases: ['citar', 'quote', 'citacao'],
    category: 'admin',
    description: 'Reescreve mensagem marcada marcando todos os membros',
    async execute(sock, m, { from, isGroup, sender, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getMessageText } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        const meta = await sock.groupMetadata(from);
        const adminsRaw = meta.participants
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin)
            .map(p => ({ id: p.id, jid: p.jid, lid: p.lid, name: p.name }));
        const isSenderAdmin = utils.isUserAdmin(sender, adminsRaw);

        if (!isSenderAdmin && !m.key.fromMe) {
            await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '📢', lastBotResponse, GLOBAL_COOLDOWN);

        const ctx = m.message.extendedTextMessage?.contextInfo;
        const quotedMessage = ctx?.quotedMessage;
        let quotedText = '';
        if (quotedMessage) {
            quotedText = getMessageText(quotedMessage) || '';
            if (!quotedText) {
                quotedText = quotedMessage.conversation
                    || quotedMessage.extendedTextMessage?.text
                    || quotedMessage.imageMessage?.caption
                    || quotedMessage.videoMessage?.caption
                    || quotedMessage.documentMessage?.caption
                    || '';
            }
        }

        let textToSend = '';
        if (quotedText) {
            // Se o usuário também digitou texto após !cita, anexa depois
            textToSend = fullArgsText ? `${quotedText}\n\n${fullArgsText}` : quotedText;
        } else {
            textToSend = fullArgsText || '📢 Atenção!';
        }

        const mentions = meta.participants.map(p => p.id);

        await sock.sendMessage(from, {
            text: textToSend,
            mentions
        }, { quoted: m });

        return currentBotResponse;
    }
};
