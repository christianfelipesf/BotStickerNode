const axios = require('axios');
const { generateRankGlobalImage } = require('../services/rankImage');
const { getTheme } = require('../services/themes');

async function fetchImageBuffer(url) {
    try {
        if (!url) return null;
        const res = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 6000,
            maxContentLength: 2 * 1024 * 1024,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        }).catch(() => null);
        if (!res || !res.data) return null;
        const buf = Buffer.from(res.data);
        if (buf.length < 100 || buf.length > 2 * 1024 * 1024) return null;
        return buf;
    } catch (_) { return null; }
}

module.exports = {
    name: 'rankglobal',
    aliases: ['topglobal', 'globalrank', 'rankgeral', 'topconversadores'],
    category: 'geral',
    description: 'Rank global mensal: top 10 pessoas mais conversadoras + foto dos top 3 grupos',
    async execute(sock, m, { from, isGroup, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, getGlobalMonthlyRank, getTopGroupsByActivity, groupMetadataCached, _getCurrentMonthKey, _getMonthLabelBr, getGroupData, getThemeForJid } = utils;

        const themeId = (typeof getThemeForJid === 'function' ? getThemeForJid(from) : ((isGroup ? getGroupData(from).theme : null) || 'default'));
        const theme = getTheme(themeId);

        let currentBotResponse = await react(sock, m, theme.rankReact || '🌍', lastBotResponse, GLOBAL_COOLDOWN);

        const botName = getBotName(isGroup ? from : null, config);
        const monthKey = _getCurrentMonthKey ? _getCurrentMonthKey() : new Date().toISOString().slice(0, 7);
        const monthLabel = _getMonthLabelBr ? _getMonthLabelBr(monthKey) : monthKey;

        const ranking = (typeof getGlobalMonthlyRank === 'function' ? getGlobalMonthlyRank(10) : []) || [];
        const topGroupsRaw = (typeof getTopGroupsByActivity === 'function' ? getTopGroupsByActivity(3) : []) || [];

        // --- avatares do top 10 (tenta direto no jid; LID também funciona no profilePictureUrl) ---
        let rankingWithAvatar = ranking;
        try {
            rankingWithAvatar = await Promise.all(ranking.map(async (u) => {
                try {
                    const url = await sock.profilePictureUrl(u.jid, 'image').catch(() => null);
                    const buf = await fetchImageBuffer(url);
                    return { ...u, avatar: buf };
                } catch (_) { return { ...u, avatar: null }; }
            }));
        } catch (_) { rankingWithAvatar = ranking; }

        // --- nome + foto dos top 3 grupos ---
        const topGroups = [];
        for (const g of topGroupsRaw) {
            let name = g.jid;
            try {
                const meta = await groupMetadataCached(sock, g.jid).catch(() => null);
                if (meta?.subject) name = meta.subject;
            } catch (_) {}
            let avatar = null;
            try {
                const url = await sock.profilePictureUrl(g.jid, 'image').catch(() => null);
                avatar = await fetchImageBuffer(url);
            } catch (_) { avatar = null; }
            topGroups.push({ jid: g.jid, name, total: g.total, members: g.members, avatar });
        }
        try {
            const okU = rankingWithAvatar.filter(x => x.avatar).length;
            const okG = topGroups.filter(x => x.avatar).length;
            console.log(`[RANKGLOBAL] avatares pessoas ${okU}/${ranking.length} • fotos grupos ${okG}/${topGroups.length}`);
        } catch (_) {}

        // --- caption ---
        let caption = `*${botName} — RANK GLOBAL* 🌍\n_top 10 pessoas mais conversadoras (todos os grupos)_\n\n`;
        caption += `📅 *Mês:* ${monthLabel} (${monthKey})\n`;
        caption += `🔄 *Reseta:* todo dia 1\n`;
        caption += `────────────────\n`;
        if (topGroups.length > 0) {
            caption += `🏆 *TOP ${topGroups.length} GRUPOS MAIS ATIVOS*\n`;
            const medalsG = ['🥇', '🥈', '🥉'];
            topGroups.forEach((g, i) => {
                const label = g.total === 1 ? '1 msg' : `${g.total} msgs`;
                caption += `${medalsG[i] || `*${i + 1}º*`} ${g.name} — ${label}\n`;
            });
            caption += `────────────────\n`;
        }
        if (!ranking || ranking.length === 0) {
            caption += `\n_Nenhum registro este mês. Envie mensagens para aparecer aqui!_\n`;
        } else {
            const medals = ['🥇', '🥈', '🥉'];
            caption += `💬 *TOP ${ranking.length} PESSOAS*\n`;
            ranking.forEach((u, i) => {
                const medal = i < 3 ? medals[i] : `*${i + 1}º*`;
                const label = u.count === 1 ? '1 msg' : `${u.count} msgs`;
                const extra = (u.groups && Number(u.groups) > 1) ? ` (${u.groups} grupos)` : '';
                caption += `${medal} ${u.name} — ${label}${extra}\n`;
            });
            if (ranking.length < 10) caption += `\n_Faltam ${10 - ranking.length} posições para completar o top 10._\n`;
        }
        caption += `\n_Use ${config.prefix}rankglobal para ver a imagem._`;

        try {
            const imgBuffer = await generateRankGlobalImage({
                botName,
                monthLabel,
                monthKey,
                ranking: rankingWithAvatar,
                topGroups,
                theme
            });
            await sock.sendMessage(from, { image: imgBuffer, caption }, { quoted: m });
            currentBotResponse = await react(sock, m, theme.ok || '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (e) {
            console.error('❌ [rankglobal] falha ao gerar imagem:', e.message);
            await sock.sendMessage(from, { text: caption }, { quoted: m });
            currentBotResponse = await react(sock, m, '⚠️', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
