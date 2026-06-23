module.exports = {
    name: 'newsativar',
    aliases: ['ativarnews'],
    category: 'grupos',
    description: 'Ativa o serviço de feed de notícias (global)',
    async execute(sock, m, { from, isGroup, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, normalizeJid, writeConfig, readConfig } = utils;

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const cfg = readConfig();
        cfg.newsEnabled = true;
        writeConfig(cfg);

        const svc = (typeof global !== 'undefined' && global.__botServices && global.__botServices.news) || null;
        if (svc) {
            try { svc.stop(); svc.start(); } catch (e) { console.error('[newsativar] start falhou:', e?.message || e); }
        }

        // Silencioso no chat: apenas reage.
        return await react(sock, m, '🟢', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
