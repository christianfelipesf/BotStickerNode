const { getTheme, normalizeThemeId, listThemes } = require('../services/themes');

module.exports = {
    name: 'temaglobal',
    aliases: ['globaltema', 'temaglob'],
    category: 'config',
    description: 'Define o tema global do bot (sobrescreve o padrão). Dono e sub-donos.',
    async execute(sock, m, { from, sender, fullArgsText, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getGlobalTheme, setGlobalTheme, clearGlobalTheme } = utils;

        const access = typeof utils.canConfigureBot === 'function'
            ? utils.canConfigureBot(sock, m, sender, from)
            : { ok: false };
        if (!access.ok) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono ou sub-donos podem usar este comando.' }, { quoted: m });
        }

        const p = config.prefix || '!';
        const arg = String(fullArgsText || '').trim().toLowerCase();
        const available = listThemes().map(t => `• *${t.id}* — ${t.label}`).join('\n');
        const currentId = typeof getGlobalTheme === 'function' ? getGlobalTheme() : 'default';
        const current = getTheme(currentId);

        const statusText = () =>
            `🌍 *Tema global:* ${currentId === 'default' ? '_desativado (vale o padrão)_' : `${current.label} *(${currentId})*`}\n` +
            `💡 Ativo, ele substitui o tema padrão em todos os grupos *sem tema próprio* (quem tem !tema próprio mantém o dele).\n\n` +
            `${available}\n• *off* — desativa (volta ao padrão)\n\n` +
            `Uso: *${p}temaglobal <nome|off>*\nEx.: *${p}temaglobal natal* 🎄 • *${p}temaglobal halloween* 🎃`;

        if (!arg || arg === 'status' || arg === 'list' || arg === 'lista' || arg === 'ver' || arg === 'help') {
            await sock.sendMessage(from, { text: statusText() }, { quoted: m });
            return lastBotResponse;
        }

        if (arg === 'off' || arg === 'desativar' || arg === 'desligar' || arg === 'reset' || arg === 'default' || arg === 'padrao' || arg === 'padrão') {
            clearGlobalTheme();
            await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, { text: '🌍 Tema global *desativado* — voltou ao padrão.' }, { quoted: m });
            return lastBotResponse;
        }

        const nid = normalizeThemeId(arg);
        if (!nid || nid === 'default') {
            await sock.sendMessage(from, { text: `❌ Tema inválido: *${arg}*\n\n${available}\n• *off* — desativa` }, { quoted: m });
            return lastBotResponse;
        }

        const next = getTheme(nid);
        if (currentId === nid) {
            await sock.sendMessage(from, { text: `🌍 Tema global já é *${next.label}*.` }, { quoted: m });
            return lastBotResponse;
        }

        setGlobalTheme(nid);
        await react(sock, m, next.react || '🌍', lastBotResponse, GLOBAL_COOLDOWN);
        await sock.sendMessage(from, { text: `🌍 Tema global atualizado para *${next.label}*! 🎨\n\nGrupos sem tema próprio passam a usar ele (menus, ranks, boas-vindas). Use *${p}temaglobal off* para voltar ao padrão.` }, { quoted: m });
        return lastBotResponse;
    }
};
