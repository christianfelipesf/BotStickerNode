const { getTheme, themeBullets } = require('../services/themes');
const { generateGroupInfoImage } = require('../services/groupInfoImage');

function fmtNum(n) {
    const v = Math.round(Number(n) || 0);
    return v.toLocaleString('pt-BR');
}

function fmtAvg(n) {
    const v = Number(n) || 0;
    if (v >= 100) return String(Math.round(v).toLocaleString('pt-BR'));
    if (v >= 10) return (Math.round(v * 10) / 10).toLocaleString('pt-BR');
    return (Math.round(v * 100) / 100).toLocaleString('pt-BR');
}

function dayOfMonthBrt() {
    try {
        const d = new Date();
        const day = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit' }).format(d);
        return Math.max(1, Number(day) || 1);
    } catch (_) { return Math.max(1, new Date().getDate()); }
}

module.exports = {
    name: 'infogrupo',
    aliases: ['analise', 'análise', 'grupo', 'groupinfo'],
    category: 'admin',
    description: 'Análise do grupo: engajamento, moderação e segurança',
    async execute(sock, m, { from, isGroup, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getAdmins, isUserAdmin, normalizeJid, getBotName, getGroupData, getThemeForJid, groupMetadataCached, getMonthlyRank, getGroupAnalytics, getAntifloodConfig } = utils;

        const themeId = (typeof getThemeForJid === 'function' ? getThemeForJid(from) : 'default');
        const theme = getTheme(themeId);
        let currentBotResponse = await react(sock, m, '📊', lastBotResponse, GLOBAL_COOLDOWN);

        if (!isGroup) {
            await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
            return currentBotResponse;
        }

        const meId = normalizeJid(sock.user?.id || '');
        const senderNorm = normalizeJid(sender);
        const isOwner = m.key.fromMe || sender === meId || senderNorm === meId;
        let isAdmin = isOwner;
        if (!isAdmin) {
            try {
                const admins = await getAdmins(sock, from);
                isAdmin = isUserAdmin(sender, admins);
            } catch (_) { isAdmin = false; }
        }
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Apenas *admins* do grupo podem usar este comando.' }, { quoted: m });
            return currentBotResponse;
        }

        const botName = getBotName(from, config);
        const B = theme.bullet || '│';

        // === Metadados do grupo ===
        let subject = 'Grupo';
        let memberCount = 0;
        let creationDate = '—';
        let onlyAdmins = false;
        try {
            const meta = await groupMetadataCached(sock, from);
            if (meta?.subject) subject = meta.subject;
            if (Array.isArray(meta?.participants)) memberCount = meta.participants.length;
            const raw = meta?.creation;
            if (raw) {
                const ts = Number(raw) > 1e12 ? Number(raw) : Number(raw) * 1000;
                const d = new Date(ts);
                if (!isNaN(d.getTime())) creationDate = d.toLocaleDateString('pt-BR');
            }
            // announce=true => só admins enviam mensagens
            onlyAdmins = !!(meta?.announce || meta?.announceMode === 'announcement');
        } catch (_) {}

        const sizeMax = 1024;

        // === Engajamento ===
        let analytics = null;
        try { analytics = getGroupAnalytics(from, 7); } catch (_) { analytics = null; }
        const hasReal = !!(analytics && analytics.hasData);

        let avgHour, avgDay, peakLabel;
        let engLabel = 'Últimos 7 dias';
        if (hasReal) {
            avgHour = analytics.avgHour;
            avgDay = analytics.avgDay;
            peakLabel = analytics.peakLabel || '—';
        } else {
            // Fallback: estimativa a partir do rank mensal (acumulado desde dia 1)
            let totalMonth = 0;
            try {
                const rankAll = getMonthlyRank(from, 50) || [];
                totalMonth = rankAll.reduce((s, u) => s + (Number(u.count) || 0), 0);
            } catch (_) {}
            const daysElapsed = dayOfMonthBrt();
            avgDay = totalMonth > 0 ? totalMonth / daysElapsed : 0;
            avgHour = avgDay / 24;
            peakLabel = '—';
            engLabel = 'Estimativa mensal';
        }

        // Membros ativos + top falante (rank mensal)
        let rank = [];
        try { rank = getMonthlyRank(from, 50) || []; } catch (_) { rank = []; }
        const activeCount = rank.length;
        const activePct = memberCount > 0 ? Math.round((activeCount / memberCount) * 100) : 0;
        const top = rank[0] || null;
        let topLine = '—';
        let topName = '—';
        let topCountLabel = '';
        const mentions = [];
        if (top) {
            topName = top.name || 'Usuário';
            topCountLabel = `${fmtNum(top.count)} msgs`;
            const digits = String(top.jid || '').split('@')[0].split(':')[0];
            if (/^\d{8,15}$/.test(digits)) {
                topLine = `@${digits} (${topCountLabel})`;
                mentions.push(top.jid);
            } else {
                topLine = `${topName} (${topCountLabel})`;
                if (top.jid) mentions.push(top.jid);
            }
        }

        // === Moderação (7 dias) ===
        const joins = analytics?.joins || 0;
        const leaves = analytics?.leaves || 0;
        const bans = analytics?.bans || 0;
        const warns7d = analytics?.warns || 0;
        const spams = analytics?.spams || 0;

        // Warns ativos agora (estoque atual, não só 7d)
        let warnsAtivos = 0;
        try {
            const gd = getGroupData(from) || {};
            const w = gd.warnings || {};
            for (const k of Object.keys(w)) warnsAtivos += Number(w[k]) || 0;
        } catch (_) {}

        // === Segurança ===
        let antilinkOn = false;
        let antifloodOn = false;
        try { antilinkOn = !!getGroupData(from)?.antilink; } catch (_) {}
        try { antifloodOn = !!getAntifloodConfig(from)?.enabled; } catch (_) {}

        const dot = (on) => (on ? '🟢' : '🔴');
        const segLine = `${dot(antilinkOn)} Anti-Link │ ${dot(antifloodOn)} Anti-Flood │ ${dot(onlyAdmins)} Apenas Admins`;

        let text = `┏━━━ 📊 *ANÁLISE DO GRUPO* ━━━┓\n` +
            `┃\n` +
            `┣ 📌 *Informações Gerais*\n` +
            `${B} 🔤 *Nome:* ${subject}\n` +
            `${B} 👥 *Membros:* ${memberCount} / ${sizeMax}\n` +
            `${B} 📅 *Criado em:* ${creationDate}\n` +
            `┃\n` +
            `┣ 📈 *Engajamento (${engLabel})*\n` +
            `${B} 💬 *Média/Hora:* ${fmtAvg(avgHour)} msgs\n` +
            `${B} 📅 *Média/Dia:* ${fmtAvg(avgDay)} msgs\n` +
            `${B} ⚡ *Horário de Pico:* ${peakLabel}\n` +
            `${B} 🔥 *Membros Ativos:* ${activeCount} (${activePct}%)\n` +
            `${B} 🏆 *Top Falante:* ${topLine}\n` +
            `┃\n` +
            `┣ 🛡️ *Moderação (Últimos 7 dias)*\n` +
            `${B} 🚪 *Entradas / Saídas:* +${joins} / -${leaves}\n` +
            `${B} 🚫 *Banimentos:* ${bans} membro(s)\n` +
            `${B} ⚠️ *Warns Aplicados:* ${warns7d}${warnsAtivos ? ` (${warnsAtivos} ativos)` : ''}\n` +
            `${B} 🔗 *Spams Bloqueados:* ${spams}\n` +
            `┃\n` +
            `┣ ⚙️ *Segurança Ativa*\n` +
            `${B} ${segLine}\n` +
            `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n` +
            `_Use ${config.prefix}rank para o top 10 do mês._`;
        text = themeBullets(text, theme);

        // Card visual estilo !rank — fallback: só texto
        try {
            const imgBuffer = await generateGroupInfoImage({
                groupName: subject,
                botName,
                engLabel,
                memberCount,
                sizeMax,
                creationDate,
                avgHour: fmtAvg(avgHour),
                avgDay: fmtAvg(avgDay),
                peakLabel,
                activeCount,
                activePct,
                topName,
                topCount: topCountLabel,
                perHour: Array.isArray(analytics?.perHour) ? analytics.perHour : [],
                hasReal,
                joins,
                leaves,
                bans,
                warns: warns7d,
                warnsAtivos,
                spams,
                antilinkOn,
                antifloodOn,
                onlyAdmins,
                theme
            });
            await sock.sendMessage(from, { image: imgBuffer, caption: text, mentions: mentions.length ? mentions : undefined }, { quoted: m });
            currentBotResponse = await react(sock, m, theme.ok || '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (e) {
            console.error('❌ [infogrupo] falha ao gerar imagem:', e.message);
            await sock.sendMessage(from, { text, mentions: mentions.length ? mentions : undefined }, { quoted: m });
            currentBotResponse = await react(sock, m, '⚠️', currentBotResponse, GLOBAL_COOLDOWN);
        }
        return currentBotResponse;
    }
};
