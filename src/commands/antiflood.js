module.exports = {
    name: 'antiflood',
    aliases: ['flood', 'anti-flood', 'antispam'],
    description: 'Ativa/configura antiflood por grupo (com opção para incluir admins)',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) {
            await sock.sendMessage(from, { text: '❌ Apenas em grupos.' }, { quoted: m });
            return lastBotResponse;
        }
        const admins = await utils.getAdmins(sock, from);
        const isSenderAdmin = utils.isUserAdmin(sender, admins);
        if (!isSenderAdmin) {
            await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
            return lastBotResponse;
        }

        const sub = String(args[0] || '').toLowerCase();
        const cfg = utils.getAntifloodConfig(from);

        // status/info
        if (['status', 'info', 'config', 'ver'].includes(sub)) {
            const txt = `🛡️ *Antiflood — ${from.endsWith('@g.us') ? 'este grupo' : ''}*\n\n` +
                `• *Ativo:* ${cfg.enabled ? '✅ sim' : '❌ não (padrão desativado)'}\n` +
                `• *Inclui admins:* ${cfg.includeAdmins ? '✅ sim' : '❌ não (padrão desativado)'}\n` +
                `• *Limite:* ${cfg.maxMsgs} msgs / ${cfg.windowSecs}s\n\n` +
                `💡 *Uso:*\n` +
                `• \`${utils.getPrefixForJid(from)}antiflood\` — liga/desliga\n` +
                `• \`${utils.getPrefixForJid(from)}antiflood admin\` — liga/desliga para admins\n` +
                `• \`${utils.getPrefixForJid(from)}antiflood 6 10\` — 6 msgs em 10s\n` +
                `• \`${utils.getPrefixForJid(from)}antiflood 6/10\` — mesmo formato`;
            await sock.sendMessage(from, { text: txt }, { quoted: m });
            return lastBotResponse;
        }

        // toggle admin inclusion
        if (['admin', 'adm', 'admins', 'moderadores'].includes(sub)) {
            const next = utils.toggleAntifloodAdmin(from);
            await utils.react(sock, m, '🛡️', lastBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, { text: `🛡️ Antiflood para *admins* ${next ? 'ativado ✅' : 'desativado ❌'} (padrão desativado).` }, { quoted: m });
            return lastBotResponse;
        }

        // set limits: "6 10" ou "6/10" ou "set 6 10"
        let max = null;
        let win = null;
        let raw = args.join(' ').trim();
        // remove prefix "set"
        if (sub === 'set') raw = args.slice(1).join(' ').trim();

        if (raw) {
            // tenta formatos: "6 10", "6/10", "6-10", "6,10"
            const m1 = raw.match(/(\d+)\s*[\/\-,]\s*(\d+)/);
            if (m1) {
                max = parseInt(m1[1], 10);
                win = parseInt(m1[2], 10);
            } else {
                const parts = raw.split(/\s+/).filter(Boolean);
                if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
                    max = parseInt(parts[0], 10);
                    win = parseInt(parts[1], 10);
                } else if (parts.length === 1 && /^\d+$/.test(parts[0]) && !['admin'].includes(parts[0])) {
                    // se só um número, assume max, mantém janela atual
                    max = parseInt(parts[0], 10);
                    win = cfg.windowSecs;
                }
            }
        }

        if (max !== null && win !== null) {
            if (max < 2 || max > 20 || win < 3 || win > 60) {
                await sock.sendMessage(from, { text: '❌ Valores inválidos. Use: 2-20 msgs em 3-60s. Ex: `!antiflood 5 8` ou `!antiflood 6/10`' }, { quoted: m });
                return lastBotResponse;
            }
            utils.setAntifloodConfig(from, { maxMsgs: max, windowSecs: win, enabled: true });
            await utils.react(sock, m, '🛡️', lastBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, { text: `✅ Antiflood configurado: *${max} msgs / ${win}s* e ativado.` }, { quoted: m });
            return lastBotResponse;
        }

        if (raw && max === null) {
            // se tinha argumento mas não foi parseável e não era admin/status, mostra ajuda
            if (sub && !['admin'].includes(sub)) {
                await sock.sendMessage(from, { text: `❌ Formato inválido. Use:\n• \`!antiflood\` liga/desliga\n• \`!antiflood admin\` inclui admins\n• \`!antiflood 5 8\` ou \`!antiflood 5/8\`\n• \`!antiflood status\`` }, { quoted: m });
                return lastBotResponse;
            }
        }

        // toggle geral
        const next = utils.toggleAntiflood(from);
        await utils.react(sock, m, '🛡️', lastBotResponse, GLOBAL_COOLDOWN);
        const cur = utils.getAntifloodConfig(from);
        await sock.sendMessage(from, {
            text: `🛡️ Antiflood ${next ? 'ativado ✅' : 'desativado ❌'} para este grupo.\n` +
                  `• Limite: ${cur.maxMsgs} msgs / ${cur.windowSecs}s\n` +
                  `• Inclui admins: ${cur.includeAdmins ? 'sim' : 'não'}\n` +
                  `💡 \`${utils.getPrefixForJid(from)}antiflood admin\` para ${cur.includeAdmins ? 'desativar' : 'ativar'} para admins.`
        }, { quoted: m });
        return lastBotResponse;
    }
};
