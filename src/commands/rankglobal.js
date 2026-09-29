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
        const { react, getBotName, getGlobalMonthlyRank, getTopGroupsByActivity, normalizeJid, isActiveGroup, isPartialActive, getGroupData, getThemeForJid, _getCurrentMonthKey, _getMonthLabelBr } = utils;

        const themeId = (typeof getThemeForJid === 'function' ? getThemeForJid(from) : ((isGroup ? getGroupData(from).theme : null) || 'default'));
        const theme = getTheme(themeId);

        let currentBotResponse = await react(sock, m, theme.rankReact || '🌍', lastBotResponse, GLOBAL_COOLDOWN);

        const botName = getBotName(isGroup ? from : null, config);
        const monthKey = _getCurrentMonthKey ? _getCurrentMonthKey() : new Date().toISOString().slice(0, 7);
        const monthLabel = _getMonthLabelBr ? _getMonthLabelBr(monthKey) : monthKey;

        const ranking = (typeof getGlobalMonthlyRank === 'function' ? getGlobalMonthlyRank(10) : []) || [];
        // Busca mais candidatos que o necessário: grupos que o bot saiu (só
        // histórico no banco) são descartados abaixo até sobrar o top 3 válido.
        const topGroupsRaw = (typeof getTopGroupsByActivity === 'function' ? getTopGroupsByActivity(10) : []) || [];

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

        // --- nome + foto dos top 3 grupos (SÓ grupos que o bot participa) ---
        const topGroups = [];
        let botUser = '';
        try { botUser = normalizeJid(sock?.user?.id || '').split('@')[0]; } catch (_) {}
        for (const g of topGroupsRaw) {
            if (topGroups.length >= 3) break;
            if (!g || !g.jid || !String(g.jid).endsWith('@g.us')) continue;
            // 1) Precisa estar ativo (total ou parcial) — histórico sozinho não basta.
            try {
                const active = (typeof isActiveGroup === 'function' && isActiveGroup(g.jid))
                    || (typeof isPartialActive === 'function' && isPartialActive(g.jid));
                if (!active) continue;
            } catch (_) {}
            // 2) Metadata direto (sem cache mascarado): falhou = bot saiu/foi removido.
            let meta = null;
            try { meta = await sock.groupMetadata(g.jid); } catch (_) { continue; }
            if (!meta || !meta.subject) continue;
            // 3) Bot precisa estar entre os participantes atuais.
            try {
                const parts = meta.participants || [];
                const botIn = parts.some((p) => {
                    try {
                        const ids = [p?.id, p?.jid, p?.lid, p?.phoneNumber].filter(Boolean).map(String);
                        if (ids.some((x) => { try { return normalizeJid(x).split('@')[0] === botUser; } catch (_) { return false; } })) return true;
                        return ids.some((x) => String(x).split('@')[0].split(':')[0] === botUser);
                    } catch (_) { return false; }
                });
                if (!botIn) continue;
            } catch (_) { continue; }
            const name = meta.subject;
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
