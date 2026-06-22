module.exports = {
    name: 'news',
    aliases: ['noticias', 'feed'],
    category: 'grupos',
    description: 'Ativa/desativa o feed automático de notícias do Reddit no grupo',
    async execute(sock, m, { from, isGroup, sender, config, utils, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, setNewsEnabled, isNewsEnabled, listNewsGroups, readConfig, normalizeJid, getAdmins, isUserAdmin, canAdminControl } = utils;

        if (!isGroup) {
            await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const sub = (fullArgsText || '').trim().split(/ +/)[0].toLowerCase();

        if (sub === 'ativar' || sub === 'on' || sub === 'ligar') {
            const meId = normalizeJid(sock.user.id);
            const senderNorm = normalizeJid(sender);
            const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

            let allowed = isBotOwner;
            if (!allowed && canAdminControl()) {
                try {
                    const adminsRaw = await getAdmins(sock, from);
                    allowed = isUserAdmin(sender, adminsRaw);
                } catch (_) {}
            }

            if (!allowed) {
                const msg = canAdminControl()
                    ? '❌ Apenas o dono do bot ou admins do grupo podem ativar o feed de notícias.'
                    : '❌ Apenas o dono do bot pode ativar o feed de notícias neste grupo.';
                await sock.sendMessage(from, { text: msg }, { quoted: m });
                return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
            }

            const cfg = readConfig();
            const subs = Array.isArray(cfg.newsSubreddits) && cfg.newsSubreddits.length > 0
                ? cfg.newsSubreddits
                : ['ShitpostBR'];

            setNewsEnabled(from, true);
            const subsText = subs.map(s => `r/${s}`).join(', ');
            await sock.sendMessage(from, {
                text: `📰 *Feed de notícias ativado!*\n\n📡 Subreddits: ${subsText}\n⏱️ Intervalo: ${Math.round((cfg.newsPollIntervalMs || 300000) / 60000)} min\n\nUse *${config.prefix}news desativar* para parar.`
            }, { quoted: m });
            return await react(sock, m, '🟢', lastBotResponse, GLOBAL_COOLDOWN);
        }

        if (sub === 'desativar' || sub === 'off' || sub === 'desligar') {
            const meId = normalizeJid(sock.user.id);
            const senderNorm = normalizeJid(sender);
            const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

            let allowed = isBotOwner;
            if (!allowed && canAdminControl()) {
                try {
                    const adminsRaw = await getAdmins(sock, from);
                    allowed = isUserAdmin(sender, adminsRaw);
                } catch (_) {}
            }

            if (!allowed) {
                const msg = canAdminControl()
                    ? '❌ Apenas o dono do bot ou admins do grupo podem desativar o feed de notícias.'
                    : '❌ Apenas o dono do bot pode desativar o feed de notícias neste grupo.';
                await sock.sendMessage(from, { text: msg }, { quoted: m });
                return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
            }

            setNewsEnabled(from, false);
            await sock.sendMessage(from, { text: '📴 Feed de notícias desativado neste grupo.' }, { quoted: m });
            return await react(sock, m, '🔴', lastBotResponse, GLOBAL_COOLDOWN);
        }

        if (sub === 'status') {
            const cfg = readConfig();
            const subs = Array.isArray(cfg.newsSubreddits) && cfg.newsSubreddits.length > 0
                ? cfg.newsSubreddits
                : ['ShitpostBR'];
            const enabled = isNewsEnabled(from);
            const totalGroups = listNewsGroups().length;
            await sock.sendMessage(from, {
                text: `📰 *Status do Feed de Notícias*\n\n📡 Estado neste grupo: ${enabled ? '🟢 Ativado' : '🔴 Desativado'}\n📚 Subreddits: ${subs.map(s => `r/${s}`).join(', ')}\n⏱️ Intervalo: ${Math.round((cfg.newsPollIntervalMs || 300000) / 60000)} min\n👥 Grupos com feed: ${totalGroups}\n\nUse *${config.prefix}news ativar* ou *${config.prefix}news desativar*.`
            }, { quoted: m });
            return await react(sock, m, 'ℹ️', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const cfg = readConfig();
        const subs = Array.isArray(cfg.newsSubreddits) && cfg.newsSubreddits.length > 0
            ? cfg.newsSubreddits
            : ['ShitpostBR'];
        const enabled = isNewsEnabled(from);

        await sock.sendMessage(from, {
            text: `📰 *Feed de Notícias*\n\n📡 Estado: ${enabled ? '🟢 Ativado' : '🔴 Desativado'}\n📚 Subreddits: ${subs.map(s => `r/${s}`).join(', ')}\n\nComandos:\n│ 🟢 *${config.prefix}news ativar*\n│ 🔴 *${config.prefix}news desativar*\n│ ℹ️ *${config.prefix}news status*\n\nNovos posts são publicados automaticamente no grupo, com imagem(ns), vídeo e legenda.`
        }, { quoted: m });
        return await react(sock, m, '📰', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
