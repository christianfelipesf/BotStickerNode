module.exports = {
    name: 'newsreset',
    aliases: ['resetnews', 'newslimpar', 'cleannews'],
    category: 'grupos',
    description: 'Reseta o estado de posts vistos do feed de notícias',
    async execute(sock, m, { from, isGroup, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, normalizeJid, clearAllNewsState, readConfig } = utils;

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const cfg = readConfig();
        const subs = Array.isArray(cfg.newsSubreddits) ? cfg.newsSubreddits : [];

        const ok = clearAllNewsState();

        await sock.sendMessage(from, {
            text: `🧹 *News resetado!*\n\n📚 ${subs.length} subreddit(s) configurado(s).\n✅ Estado de posts vistos limpo.\n🔄 Próximo poll publicará o último post atual de cada sub.`
        }, { quoted: m });
        return await react(sock, m, ok ? '🧹' : '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
