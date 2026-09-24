module.exports = {
    name: 'humanizar',
    aliases: ['humanize', 'antiban', 'anti-ban', 'modohumano', 'modo-humano'],
    category: 'config',
    description: 'Liga/desliga o modo humanizado anti-ban (digitando, delay humano, anti-rajada)',
    async execute(sock, m, { from, sender, args, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, writeConfig, readConfig } = utils;
        const { getHumanSettings } = require('../services/humanize');

        const access = typeof utils.canConfigureBot === 'function'
            ? utils.canConfigureBot(sock, m, sender, from)
            : { ok: (() => { const meId = utils.normalizeJid(sock.user.id); const senderNorm = utils.normalizeJid(sender); return m.key.fromMe === true || sender === meId || senderNorm === meId; })() };
        if (!access.ok) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono ou sub-donos podem usar este comando.' }, { quoted: m });
        }

        const sub = String(args[0] || '').toLowerCase();
        const cfg = readConfig();

        const statusText = () => {
            const s = getHumanSettings(cfg);
            return `🤖 *Modo Humanizado ${s.enabled ? '🟢 ATIVADO' : '🔴 DESATIVADO'}*\n\n` +
                `Quando ativado o bot finge ser humano:\n` +
                `│ ⌨️ mostra *digitando...* antes de responder\n` +
                `│ 👀 marca como *lido* antes de responder\n` +
                `│ ⏳ delay proporcional ao texto + jitter\n` +
                `│ 🐢 throttle anti-rajada entre envios\n` +
                `│ 🕵️ browser de PC real + sem "online" fixo\n\n` +
                `╭─── *AJUSTES ATUAIS* ───\n` +
                `│ 🔘 humanMode: *${s.enabled}*\n` +
                `│ ⏱️ delay: ${cfg.humanMinDelayMs}–${cfg.humanMaxDelayMs}ms\n` +
                `│ ✍️ ms/caractere: ${cfg.humanMsPerChar} (teto ${cfg.humanMaxTypingMs}ms)\n` +
                `│ 📶 presença: *${cfg.humanPresence !== false}* • lido: *${cfg.humanReadReceipt !== false}*\n` +
                `│ 🐢 throttle: ${cfg.humanThrottleMs}ms\n` +
                `╰───────────────\n\n` +
                `Uso: *${config.prefix}humanizar on* • *${config.prefix}humanizar off*`;
        };

        if (!sub || sub === 'status' || sub === 'ver') {
            await sock.sendMessage(from, { text: statusText() }, { quoted: m });
            return lastBotResponse;
        }
        if (sub === 'on' || sub === 'ativar' || sub === '1' || sub === 'true') {
            cfg.humanMode = true;
            writeConfig(cfg);
            try { require('../services/ai'); } catch (_) {}
            const r = await react(sock, m, '🤖', lastBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, { text: '🤖 *Modo Humanizado ATIVADO!* ✅\n\nO bot agora digita, espera e envia como um humano para reduzir risco de ban.' }, { quoted: m });
            return r;
        }
        if (sub === 'off' || sub === 'desativar' || sub === '0' || sub === 'false') {
            cfg.humanMode = false;
            writeConfig(cfg);
            const r = await react(sock, m, '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, { text: '⚠️ *Modo Humanizado DESATIVADO.*\n\nO bot volta a responder na hora (mais rápido, porém mais fácil de detectar como automação).' }, { quoted: m });
            return r;
        }
        await sock.sendMessage(from, { text: `❌ Use: *${config.prefix}humanizar on|off|status*\n\n${statusText()}` }, { quoted: m });
        return lastBotResponse;
    }
};
