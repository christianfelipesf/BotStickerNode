module.exports = {
    name: 'set',
    category: 'config',
    description: 'Altera uma configuração do bot',
    async execute(sock, m, { from, sender, args, config, utils, ai, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, writeConfig, readConfig } = utils;
        const { setupAI } = ai;
        
        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }
        
        const p = args[0]; 
        const v = args.slice(1).join(' ');
        
        if (!p) {
            await sock.sendMessage(from, { text: `❌ Use: ${config.prefix}set <parâmetro> <valor>\n💡 Veja todas as opções: \`${config.prefix}set help\`` }, { quoted: m });
            return lastBotResponse;
        }
        
        if (p === 'help' || p === 'list' || p === '?') {
            const defaults = (typeof utils.getDefaultConfig === 'function')
                ? utils.getDefaultConfig()
                : (() => {
                    try { return require('../database/utils').DEFAULT_CONFIG; } catch (_) { return null; }
                })();
            if (!defaults) {
                await sock.sendMessage(from, { text: '❌ Não foi possível carregar a lista de configurações.' }, { quoted: m });
                return lastBotResponse;
            }

            const typeOf = (val) => {
                if (Array.isArray(val)) return 'array';
                if (typeof val === 'number') return Number.isInteger(val) ? 'inteiro' : 'número';
                if (typeof val === 'boolean') return 'booleano';
                if (typeof val === 'string') return 'texto';
                return typeof val;
            };

            const allKeys = Object.keys(defaults).sort();
            const current = config || {};
            const lines = [`⚙️ *Configurações editáveis (${allKeys.length})*`, ''];
            for (const k of allKeys) {
                const def = defaults[k];
                const t = typeOf(def);
                const has = Object.prototype.hasOwnProperty.call(current, k) || k === 'prefix';
                let extra = '';
                if (t === 'inteiro' || t === 'número') extra = ' (aceita sufixos ms/s/m/h em alguns casos)';
                else if (t === 'booleano') extra = ' (true/false)';
                else if (t === 'array') extra = ' (valores separados por vírgula ou espaço)';
                else if (k === 'dashboardUrl') extra = ' (http(s)://...)';
                lines.push(`• *${k}* — _${t}_${extra}`);
            }
            lines.push('');
            lines.push(`Uso: \`${config.prefix}set <parâmetro> <valor>\``);
            lines.push(`Ex.: \`${config.prefix}set botName Antigravity Bot\``);
            lines.push(`Veja o valor atual: \`${config.prefix}set <parâmetro>\` (sem valor)`);
            await sock.sendMessage(from, { text: lines.join('\n') }, { quoted: m });
            return lastBotResponse;
        }

        if (config[p] !== undefined || p === 'prefix') {
            if (!v) {
                await sock.sendMessage(from, { text: `📝 *${p}* atual: ${config[p]}` }, { quoted: m });
                return lastBotResponse;
            }
            
            if (p === 'prefix') config.prefix = v.trim()[0] || '!';
            else if (p === 'showLogoInMenu' || p === 'voiceEffects' || p === 'dashboardEnabled' || p === 'newsEnabled' || p === 'newsRandomSub' || p === 'newsOnePerCycle') config[p] = v.toLowerCase() === 'true';
            else if (p === 'summaryLimit' || p === 'clearDefaultLimit' || p === 'dashboardPort' || p === 'dashboardMaxLogs' || p === 'dashboardHistoryHours' || p === 'newsSendDelayMs' || p === 'newsFetchStaggerMs' || p === 'newsMaxPerCycle' || p === 'newsMaxRetries' || p === 'newsRetryBaseDelayMs' || p === 'dashboardTrimIntervalMs') config[p] = parseInt(v, 10);
            else if (p === 'newsPollIntervalMinutes' || p === 'newsPollIntervalMs') {
                // Aceita: "45" (minutos), "45m", "60s", "1h", "2700000ms".
                // newsPollIntervalMinutes → grava em MINUTOS (número puro).
                // newsPollIntervalMs (legado) → grava em ms.
                const m = String(v || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/);
                if (!m) {
                    await sock.sendMessage(from, { text: `❌ Formato inválido. Use: ${config.prefix}set newsPollIntervalMinutes 45m  (ou 60s, 1h)` }, { quoted: m });
                    return lastBotResponse;
                }
                const num = parseFloat(m[1]);
                const unit = m[2] || 'm';
                if (p === 'newsPollIntervalMinutes') {
                    // Grava SEMPRE em minutos (forma padrão da chave).
                    if (unit === 'ms') config[p] = Math.round(num / 60000);
                    else if (unit === 's') config[p] = Math.round(num / 60);
                    else if (unit === 'm') config[p] = Math.round(num);
                    else if (unit === 'h') config[p] = Math.round(num * 60);
                } else {
                    // Legado: grava em ms.
                    let totalMs;
                    if (unit === 'ms') totalMs = Math.round(num);
                    else if (unit === 's') totalMs = Math.round(num * 1000);
                    else if (unit === 'm') totalMs = Math.round(num * 60 * 1000);
                    else if (unit === 'h') totalMs = Math.round(num * 60 * 60 * 1000);
                    config[p] = totalMs;
                }
            }
            else if (p === 'newsSubreddits') {
                const raw = String(v || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
                const seen = new Set();
                const out = [];
                for (const s of raw) {
                    let n = s.replace(/^r\//i, '').replace(/^\//, '').replace(/\/$/, '').toLowerCase();
                    if (!n) continue;
                    if (!/^[a-z0-9_]{2,32}$/.test(n)) {
                        await sock.sendMessage(from, { text: `❌ Subreddit inválido ignorado: *${s}*` }, { quoted: m });
                        continue;
                    }
                    if (seen.has(n)) continue;
                    seen.add(n);
                    out.push(n);
                }
                if (out.length === 0) {
                    await sock.sendMessage(from, { text: `❌ Nenhum subreddit válido informado. Use: ${config.prefix}set newsSubreddits pics,ShitpostBR` }, { quoted: m });
                    return lastBotResponse;
                }
                config[p] = out;
            }
            else if (p === 'dashboardUrl') {
                const u = String(v || '').trim();
                if (!/^https?:\/\/.+/i.test(u)) {
                    await sock.sendMessage(from, { text: `❌ URL inválida. Use o formato: ${config.prefix}set dashboardUrl https://seu-dominio.com` }, { quoted: m });
                    return lastBotResponse;
                }
                config[p] = u.replace(/\/+$/, '');
            }
            else config[p] = v;
            
            writeConfig(config);
            // Refresh local config and AI
            const newConfig = readConfig();
            setupAI(newConfig);

            // Controle runtime do news (start/stop sem reiniciar o bot).
            // Aplica em mudanças de newsEnabled OU newsPollIntervalMinutes OU newsSubreddits.
            if (p === 'newsEnabled' || p === 'newsPollIntervalMinutes' || p === 'newsPollIntervalMs' || p === 'newsSubreddits') {
                const svc = (typeof global !== 'undefined' && global.__botServices && global.__botServices.news) || null;
                if (svc && newConfig.newsEnabled !== false) {
                    try {
                        svc.stop();
                        svc.start();
                    } catch (e) {
                        console.error('[set] falha ao reiniciar news:', e?.message || e);
                    }
                } else if (svc && newConfig.newsEnabled === false) {
                    try { svc.stop(); } catch (e) { console.error('[set] stop news:', e?.message || e); }
                }
            }

            let currentBotResponse = await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
            await sock.sendMessage(from, { text: `✅ *${p}* atualizado!` }, { quoted: m });
            return currentBotResponse;
        } else {
            await sock.sendMessage(from, { text: `❌ Parâmetro inválido!` }, { quoted: m });
            return lastBotResponse;
        }
    }
};
