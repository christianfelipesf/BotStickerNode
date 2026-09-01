module.exports = {
    name: 'limparfeedback',
    aliases: [],
    category: 'admin',
    description: 'Limpa logs de feedback (sugestões/bugs) — só admin',
    async execute(sock, m, { from, isGroup, sender, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, normalizeJid, getAdmins, isUserAdmin, clearFeedback, countFeedback } = utils;

        const meId = normalizeJid(sock.user?.id || '');
        const senderNorm = normalizeJid(sender);
        const isOwner = m.key.fromMe || sender === meId || senderNorm === meId;

        let allowed = isOwner;
        if (!allowed && isGroup) {
            try {
                const admins = await getAdmins(sock, from);
                allowed = isUserAdmin(sender, admins);
            } catch (_) { allowed = false; }
        }

        if (!allowed) {
            const msg = isGroup
                ? '❌ Apenas *admins* do grupo podem limpar os logs de feedback.'
                : '❌ Apenas o dono do bot pode usar este comando.';
            await sock.sendMessage(from, { text: msg }, { quoted: m });
            return lastBotResponse;
        }

        let current = await react(sock, m, '🧹', lastBotResponse, GLOBAL_COOLDOWN);

        const raw = String(fullArgsText || '').trim().toLowerCase();
        // decide alvo: bug | sugestao | all
        let target = 'all';
        if (raw) {
            if (raw.includes('bug') && !raw.includes('sugest')) target = 'bug';
            else if ((raw.includes('sugest') || raw.includes('sugest')) && !raw.includes('bug')) target = 'sugestao';
            else if (raw.includes('bug') && raw.includes('sugest')) target = 'all';
            else if (raw === 'all' || raw === 'tudo' || raw === 'todos' || raw === 'ambos') target = 'all';
            else {
                // argumento desconhecido — mostra ajuda
                await sock.sendMessage(from, {
                    text: `🧹 *Limpar Feedback*\n\n` +
                        `Use:\n` +
                        `• *!limparfeedback* — limpa *tudo* (bugs + sugestões)\n` +
                        `• *!limparfeedback bug* — limpa só bugs 🐛\n` +
                        `• *!limparfeedback sugestao* — limpa só sugestões 💡\n\n` +
                        `📌 Atual: 🐛 ${countFeedback('bug')} bug(s) | 💡 ${countFeedback('sugestao')} sugestão(ões)`
                }, { quoted: m });
                return current;
            }
        }

        let removed = 0;
        let msg = '';
        if (target === 'all') {
            const cBug = clearFeedback('bug');
            const cSug = clearFeedback('sugestao');
            removed = (Number(cBug) || 0) + (Number(cSug) || 0);
            msg = removed > 0
                ? `✅ *Feedbacks limpos!* 🧹\n\n🗑️ Removidos: *${removed}* registro(s)\n• 🐛 Bugs: ${cBug}\n• 💡 Sugestões: ${cSug}`
                : `ℹ️ Nenhum feedback para limpar.\n🐛 Bugs: 0 | 💡 Sugestões: 0`;
        } else if (target === 'bug') {
            removed = clearFeedback('bug');
            msg = removed > 0
                ? `✅ *Bugs limpos!* 🐛\n\n🗑️ Removidos: *${removed}* bug(s)`
                : `ℹ️ Nenhum bug para limpar.`;
        } else if (target === 'sugestao') {
            removed = clearFeedback('sugestao');
            msg = removed > 0
                ? `✅ *Sugestões limpas!* 💡\n\n🗑️ Removidas: *${removed}* sugestão(ões)`
                : `ℹ️ Nenhuma sugestão para limpar.`;
        }

        await sock.sendMessage(from, { text: msg }, { quoted: m });
        current = await react(sock, m, removed > 0 ? '✅' : 'ℹ️', current, GLOBAL_COOLDOWN);
        return current;
    }
};
