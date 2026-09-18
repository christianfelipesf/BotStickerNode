const HELP = '💡 *Splash* — curiosidade automática (anti-spam: 1x a cada 6h + mín. 60 msgs)\n\n' +
    '❌ Use:\n' +
    '!splash on|off|status|teste|intervalo <n>|reset\n\n' +
    '• *on/off* — liga/desliga global (só dono)\n' +
    '• *status* — mostra estado atual\n' +
    '• *teste* — manda 1 curiosidade agora (não conta no limite de 6h)\n' +
    '• *intervalo 60* — troca o gatilho (60-200, só dono)\n' +
    '• *reset* — zera o contador deste grupo';

module.exports = {
    name: 'splash',
    aliases: ['curiosidade', 'curiosidades', 'vocesabia', 'voce-sabia'],
    category: 'geral',
    description: 'Liga/desliga o splash de curiosidades e testa uma agora',
    async execute(sock, m, { from, isGroup, sender, args, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, normalizeJid, writeConfig, readConfig } = utils;
        const splash = require('../services/splash');
        const sub = String((args && args[0]) || '').toLowerCase();

        if (!sub) {
            return await sock.sendMessage(from, { text: HELP }, { quoted: m });
        }

        if (sub === 'status' || sub === 'ver') {
            const cfg = readConfig();
            const on = cfg.splashEnabled !== false;
            const interval = Math.max(60, Math.min(200, Number(cfg.splashInterval) || 60));
            const cooldownMs = typeof splash.getCooldownMs === 'function' ? splash.getCooldownMs() : 21600000;
            const cooldownH = (cooldownMs / 3600000).toFixed(cooldownMs % 3600000 === 0 ? 0 : 1);
            const count = isGroup ? splash.getCount(from) : 0;
            const faltam = isGroup ? Math.max(0, interval - count) : '-';
            let tempoTxt = '';
            if (isGroup && typeof splash.getTimeRemainingMs === 'function') {
                const rest = splash.getTimeRemainingMs(from);
                if (rest > 0) {
                    const h = Math.floor(rest / 3600000);
                    const min = Math.ceil((rest % 3600000) / 60000);
                    tempoTxt = `\n• Próximo aviso em: *${h}h ${min}min* (limite 1x/${cooldownH}h por grupo)`;
                } else if (faltam === 0) {
                    tempoTxt = '\n• Pronto para enviar na próxima mensagem ✅';
                }
            }
            return await sock.sendMessage(from, {
                text: `💡 *Splash* (anti-spam)\n\n• Estado global: ${on ? '🟢 ligado' : '🔴 desligado'}\n• Regra: *1x a cada ${cooldownH}h* + mín. *${interval}* mensagens\n` +
                    (isGroup ? `• Neste grupo: ${count}/${interval} (faltam ${faltam})${tempoTxt}\n` : '') +
                    `\n_Comandos: !splash teste | !splash on | !splash off_`
            }, { quoted: m });
        }

        if (sub === 'teste' || sub === 'test' || sub === 'testar' || sub === 'curiosidade' || sub === 'agora') {
            if (isGroup) {
                try {
                    const { isActiveGroup } = utils;
                    if (!isActiveGroup(from)) {
                        return await sock.sendMessage(from, { text: '🤐 Bot desativado neste grupo. Peça a um admin para usar !ativar.' }, { quoted: m });
                    }
                } catch (_) {}
                // Freio manual: 1 teste a cada 30s por grupo (não mexe na janela de 6h do automático).
                try {
                    if (typeof splash.checkTesteCooldown === 'function') {
                        const wait = splash.checkTesteCooldown(from);
                        if (wait > 0) {
                            return await sock.sendMessage(from, { text: `⏳ Aguarde *${Math.ceil(wait / 1000)}s* para testar de novo (anti-spam).` }, { quoted: m });
                        }
                    }
                } catch (_) {}
            }
            await react(sock, m, '💡', lastBotResponse, GLOBAL_COOLDOWN);
            const curiosidade = splash.pickRandom();
            await splash.sendSplash(sock, from, { curiosidade, prefix: config.prefix, quoted: m });
            return lastBotResponse;
        }

        if (sub === 'reset' || sub === 'zerar') {
            if (!isGroup) return await sock.sendMessage(from, { text: '❌ Use dentro de um grupo.' }, { quoted: m });
            // Reset mexe no contador do grupo: exige admin do grupo ou dono do bot.
            try {
                const admins = await utils.getAdmins(sock, from);
                const meIdR = normalizeJid(sock.user.id);
                const senderNormR = normalizeJid(sender);
                const isOwnerR = m.key.fromMe === true || sender === meIdR || senderNormR === meIdR;
                if (!isOwnerR && !utils.isUserAdmin(sender, admins)) {
                    return await sock.sendMessage(from, { text: '❌ Apenas administradores podem zerar o contador do splash.' }, { quoted: m });
                }
            } catch (_) {}
            splash.reset(from);
            await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, { text: '✅ Contador do splash zerado neste grupo.\n_O limite de 1x/6h continua valendo (reset não fura a janela anti-spam)._' }, { quoted: m });
        }

        // --- on/off/intervalo: só dono do bot (global) ---
        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode ligar/desligar o splash global.' }, { quoted: m });
        }

        if (sub === 'on' || sub === 'ativar' || sub === 'ligar' || sub === 'enable') {
            const cfg = readConfig();
            cfg.splashEnabled = true;
            writeConfig(cfg);
            await react(sock, m, '🟢', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, { text: '🟢 *Splash ligado globalmente!* Curiosidade a cada mensagens configuradas.' }, { quoted: m });
        }
        if (sub === 'off' || sub === 'desativar' || sub === 'desligar' || sub === 'disable') {
            const cfg = readConfig();
            cfg.splashEnabled = false;
            writeConfig(cfg);
            await react(sock, m, '🔴', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, { text: '🔴 *Splash desligado globalmente.*' }, { quoted: m });
        }
        if (sub === 'intervalo' || sub === 'interval' || sub === 'set' || sub === 'cada') {
            const n = parseInt(args[1], 10);
            if (!Number.isFinite(n) || n < 60 || n > 200) {
                return await sock.sendMessage(from, { text: '❌ Use: !splash intervalo <60-200>. Ex: !splash intervalo 60' }, { quoted: m });
            }
            const cfg = readConfig();
            cfg.splashInterval = n;
            writeConfig(cfg);
            await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, { text: `✅ Splash agora a cada *${n}* mensagens.` }, { quoted: m });
        }

        return await sock.sendMessage(from, { text: HELP }, { quoted: m });
    }
};
