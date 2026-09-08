const axios = require('axios');
const { generateRankImage } = require('../services/rankImage');

module.exports = {
    name: 'rank',
    aliases: ['rankativos', 'rankmensal', 'topativos', 'top10', 'ranking'],
    category: 'geral',
    description: 'Rank mensal dos 10 mais ativos — reseta todo dia 1',
    async execute(sock, m, { from, isGroup, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, getMonthlyRank, isActiveGroup, isPartialActive, groupMetadataCached, _getCurrentMonthKey, _getMonthLabelBr } = utils;

        let currentBotResponse = await react(sock, m, '🏆', lastBotResponse, GLOBAL_COOLDOWN);

        if (!isGroup) {
            await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
            return currentBotResponse;
        }

        const isActive = isActiveGroup(from);
        const isPartial = isPartialActive(from);
        if (!isActive && !isPartial) {
            await sock.sendMessage(from, { text: `❌ Este grupo não está ativo.\nUse *${config.prefix}ativar* (dono) ou *${config.prefix}ativarp* para ativar.` }, { quoted: m });
            await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
            return currentBotResponse;
        }

        const botName = getBotName(from, config);
        const monthKey = _getCurrentMonthKey ? _getCurrentMonthKey() : new Date().toISOString().slice(0, 7);
        const monthLabel = _getMonthLabelBr ? _getMonthLabelBr(monthKey) : monthKey;

        let groupName = 'Grupo';
        try {
            const meta = await groupMetadataCached(sock, from);
            groupName = meta?.subject || groupName;
        } catch (_) {}

        const ranking = getMonthlyRank(from, 10);

        // Busca fotos de perfil para os top 10 (se disponível)
        let rankingWithAvatar = ranking;
        if (ranking.length > 0) {
            try {
                const avatarResults = await Promise.all(ranking.map(async (u) => {
                    const jid = u.jid;
                    // @lid não tem foto direta — usa placeholder (evita rate-limit)
                    if (!jid || jid.endsWith('@lid')) return { ...u, avatar: null };
                    try {
                        const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
                        if (!url) return { ...u, avatar: null };
                        const res = await axios.get(url, {
                            responseType: 'arraybuffer',
                            timeout: 4000,
                            maxContentLength: 2 * 1024 * 1024,
                            headers: { 'User-Agent': 'Mozilla/5.0' }
                        }).catch(() => null);
                        if (!res || !res.data) return { ...u, avatar: null };
                        const buf = Buffer.from(res.data);
                        if (buf.length > 2 * 1024 * 1024) return { ...u, avatar: null };
                        return { ...u, avatar: buf };
                    } catch (_) {
                        return { ...u, avatar: null };
                    }
                }));
                rankingWithAvatar = avatarResults;
            } catch (_) {
                rankingWithAvatar = ranking;
            }
        }

        // Texto fallback curto para caption
        let caption = `*${botName} — Rank Mensal* 🏆\n_top 10 mais ativos_\n\n`;
        caption += `📅 *Mês:* ${monthLabel} (${monthKey})\n`;
        caption += `👥 *Grupo:* ${groupName}\n`;
        caption += `${isPartial ? '🟡 *Modo:* Parcial (subativo)\n' : '🟢 *Modo:* Ativo\n'}`;
        caption += `🔄 *Reseta:* todo dia 1\n`;
        caption += `────────────────\n`;
        if (!ranking || ranking.length === 0) {
            caption += `\n_Nenhum registro este mês. Envie mensagens para aparecer aqui!_\n`;
        } else {
            const medals = ['🥇', '🥈', '🥉'];
            ranking.forEach((u, i) => {
                const medal = i < 3 ? medals[i] : `*${i + 1}º*`;
                const label = u.count === 1 ? '1 msg' : `${u.count} msgs`;
                caption += `${medal} ${u.name} — ${label}\n`;
            });
            if (ranking.length < 10) caption += `\n_Faltam ${10 - ranking.length} posições para completar o top 10._\n`;
        }
        caption += `\n_Use ${config.prefix}rank ou ${config.prefix}rankativos para ver a imagem._`;

        // Gera imagem (com avatares se tiver)
        try {
            const imgBuffer = await generateRankImage({
                groupName,
                botName,
                monthLabel,
                ranking: rankingWithAvatar,
                monthKey
            });
            await sock.sendMessage(from, { image: imgBuffer, caption }, { quoted: m });
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (e) {
            console.error('❌ [rank] falha ao gerar imagem:', e.message);
            // Fallback apenas texto
            await sock.sendMessage(from, { text: caption }, { quoted: m });
            currentBotResponse = await react(sock, m, '⚠️', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
