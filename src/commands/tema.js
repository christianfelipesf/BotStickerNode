const { getTheme, normalizeThemeId, listThemes } = require('../services/themes');

module.exports = {
    name: 'tema',
    aliases: ['theme', 'temas'],
    category: 'admin',
    description: 'Altera o tema do bot neste grupo (admin). Ex: !tema hell, !tema reset',
    async execute(sock, m, { from, isGroup, sender, fullArgsText, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getAdmins, isUserAdmin, getGroupData, setGroupData, getBotName } = utils;

        if (!isGroup) {
            await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
            return lastBotResponse;
        }

        let isAdmin = false;
        try {
            const admins = await getAdmins(sock, from);
            isAdmin = isUserAdmin(sender, admins);
        } catch (_) { isAdmin = false; }
        if (!isAdmin) {
            await sock.sendMessage(from, { text: '❌ Apenas *admins* do grupo podem usar este comando.' }, { quoted: m });
            return lastBotResponse;
        }

        const arg = String(fullArgsText || '').trim().toLowerCase();
        const groupData = getGroupData(from);
        const currentId = String(groupData.theme || 'default').toLowerCase();
        const current = getTheme(currentId);
        const available = listThemes().map(t => `• *${t.id}* — ${t.label}`).join('\n');

        if (!arg || arg === 'list' || arg === 'lista' || arg === 'help') {
            await sock.sendMessage(from, {
                text: `*${getBotName(from, config)} — Temas* 🎨\n_tema atual: ${current.label}_\n\n${available}\n• *reset* — volta ao padrão\n\nUso: *${config.prefix}tema <nome|reset>*`
            }, { quoted: m });
            return lastBotResponse;
        }

        const nid = normalizeThemeId(arg);
        if (!nid) {
            await sock.sendMessage(from, { text: `❌ Tema inválido: *${arg}*\n\n${available}\n• *reset* — volta ao padrão` }, { quoted: m });
            return lastBotResponse;
        }

        const next = getTheme(nid);

        if (nid === 'default') {
            const prevName = getGroupData(from).botName;
            const data = { theme: null };
            if (prevName) {
                let cleaned = prevName;
                for (const t of Object.values(require('../services/themes').THEMES)) {
                    if (t.botSuffix) cleaned = cleaned.split(t.botSuffix).join('').trim();
                }
                data.botName = cleaned || null;
            }
            setGroupData(from, data);
            await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, { text: `✅ Tema *resetado* para o padrão neste grupo.` }, { quoted: m });
            return lastBotResponse;
        }

        if (currentId === nid) {
            await sock.sendMessage(from, { text: next.phrases.already || `Este grupo já está no tema ${next.label}.` }, { quoted: m });
            return lastBotResponse;
        }

        const data = { theme: nid };
        if (next.botSuffix) {
            const base = String(groupData.botName || config.botName || 'Bot').replace(/[\n\r]/g, ' ').trim().slice(0, 24);
            const withoutOld = (() => {
                let c = base;
                for (const t of Object.values(require('../services/themes').THEMES)) {
                    if (t.botSuffix) c = c.split(t.botSuffix).join('').trim();
                }
                return c;
            })();
            data.botName = `${withoutOld} ${next.botSuffix}`.trim().slice(0, 30);
        }
        setGroupData(from, data);

        await react(sock, m, next.react || '🎨', lastBotResponse, GLOBAL_COOLDOWN);
        await sock.sendMessage(from, { text: `${next.phrases.activated || `Tema ${next.label} ativado!`}\n\n_Nome do bot e menu atualizados para o clima. Use *${config.prefix}tema reset* para voltar ao padrão._` }, { quoted: m });
        return lastBotResponse;
    }
};
