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
            await sock.sendMessage(from, { text: `❌ Use: ${config.prefix}set <parâmetro> <valor>` }, { quoted: m });
            return lastBotResponse;
        }
        
        if (config[p] !== undefined || p === 'prefix') {
            if (!v) {
                await sock.sendMessage(from, { text: `📝 *${p}* atual: ${config[p]}` }, { quoted: m });
                return lastBotResponse;
            }
            
            if (p === 'prefix') config.prefix = v.trim()[0] || '!';
            else if (p === 'showLogoInMenu' || p === 'voiceEffects' || p === 'dashboardEnabled' || p === 'newsEnabled' || p === 'newsRandomSub' || p === 'newsOnePerCycle') config[p] = v.toLowerCase() === 'true';
            else if (p === 'summaryLimit' || p === 'clearDefaultLimit' || p === 'dashboardPort' || p === 'dashboardMaxLogs' || p === 'dashboardHistoryHours' || p === 'newsPollIntervalMs' || p === 'newsSendDelayMs' || p === 'newsFetchStaggerMs' || p === 'newsMaxPerCycle' || p === 'newsMaxRetries' || p === 'newsRetryBaseDelayMs' || p === 'dashboardTrimIntervalMs') config[p] = parseInt(v, 10);
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
            if (p === 'newsEnabled') {
                const svc = (typeof global !== 'undefined' && global.__botServices && global.__botServices.news) || null;
                if (svc) {
                    try {
                        if (newConfig.newsEnabled === false) {
                            svc.stop();
                        } else {
                            svc.stop();
                            svc.start();
                        }
                    } catch (e) {
                        console.error('[set] falha ao alternar news:', e?.message || e);
                    }
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
