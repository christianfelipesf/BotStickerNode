const { parseSubredditInput, probeSubreddit } = require('../services/news');

const MAX_PER_CMD = 10;

function restartNewsService(newConfig) {
    const svc = (typeof global !== 'undefined' && global.__botServices && global.__botServices.news) || null;
    if (!svc) return;
    try {
        if (newConfig.newsEnabled === false) svc.stop();
        else { svc.stop(); svc.start(); }
    } catch (e) {
        console.error('[subreddit] falha ao reiniciar news:', e?.message || e);
    }
}

function usage(prefix) {
    return `📚 *Subreddits do feed de notícias*\n\n` +
        `➕ \`${prefix}subreddit add pics, r/gatos, https://www.reddit.com/r/memes\`\n` +
        `➖ \`${prefix}subreddit del pics, memes\`\n` +
        `📋 \`${prefix}subreddit list\`\n\n` +
        `💡 Aceita vários formatos (nome, r/nome, link) e vários de uma vez.\n` +
        `🔎 Cada sub é *testado no Reddit* antes de entrar — inválido não entra.\n` +
        `👑 Só dono/subdono. Para trocar a lista inteira: \`${prefix}set newsSubreddits ...\``;
}

module.exports = {
    name: 'subreddit',
    aliases: ['sub', 'subs', 'subreddits', 'addsub', 'remsub', 'delsub'],
    category: 'config',
    description: 'Adiciona/remove subreddits do feed (dono/subdono, com teste no Reddit)',
    async execute(sock, m, { from, sender, args, commandName, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, writeConfig, readConfig } = utils;

        const access = typeof utils.canConfigureBot === 'function'
            ? utils.canConfigureBot(sock, m, sender, from)
            : { ok: false };
        if (!access.ok) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono ou sub-donos podem usar este comando.' }, { quoted: m });
        }

        const prefix = config.prefix || '!';
        // Atalhos: !addsub X = add, !remsub/!delsub X = del.
        let action = String(args?.[0] || '').toLowerCase();
        let rest = (args || []).slice(1).join(' ');
        if (['addsub'].includes(commandName)) { action = 'add'; rest = (args || []).join(' '); }
        else if (['remsub', 'delsub'].includes(commandName)) { action = 'del'; rest = (args || []).join(' '); }
        if (['del', 'rem', 'remove', 'remover', 'rm', 'excluir', 'tirar'].includes(action)) action = 'del';
        else if (['add', 'adicionar', 'novo', '+'].includes(action)) action = 'add';
        else if (['list', 'lista', 'ver', 'ls', 'status', ''].includes(action)) action = 'list';

        const cfg = readConfig();
        const current = Array.isArray(cfg.newsSubreddits) ? [...cfg.newsSubreddits] : [];
        const currentSet = new Set(current);

        if (action === 'list') {
            const body = current.length > 0
                ? current.map(s => `• r/${s}`).join('\n')
                : '_nenhum configurado_';
            await sock.sendMessage(from, {
                text: `📚 *Subreddits monitorados (${current.length})*\n\n${body}\n\n${usage(prefix)}`
            }, { quoted: m });
            return lastBotResponse;
        }

        if (action === 'del') {
            if (!rest.trim()) {
                await sock.sendMessage(from, { text: `❌ Informe quais remover.\nEx.: \`${prefix}subreddit del pics, memes\`` }, { quoted: m });
                return lastBotResponse;
            }
            const { valid, invalid } = parseSubredditInput(rest);
            const removed = valid.filter(s => currentSet.has(s));
            const notFound = valid.filter(s => !currentSet.has(s));
            if (removed.length === 0) {
                await sock.sendMessage(from, {
                    text: `ℹ️ Nada para remover — nenhum desses está na lista.`
                        + (notFound.length ? `\nNão estão: ${notFound.map(s => `r/${s}`).join(', ')}` : '')
                        + (invalid.length ? `\nInválidos: ${invalid.join(', ')}` : '')
                        + `\n\n📚 Atual: ${current.map(s => `r/${s}`).join(', ') || '_vazia_'}`
                }, { quoted: m });
                return lastBotResponse;
            }
            const next = current.filter(s => !removed.includes(s));
            config.newsSubreddits = next;
            writeConfig(config);
            restartNewsService(readConfig());
            let msg = `➖ *Removidos (${removed.length}):* ${removed.map(s => `r/${s}`).join(', ')}\n📚 *Restam (${next.length}):* ${next.map(s => `r/${s}`).join(', ') || '_nenhum_'}`;
            if (notFound.length) msg += `\n⚠️ Não estavam na lista: ${notFound.map(s => `r/${s}`).join(', ')}`;
            if (invalid.length) msg += `\n⚠️ Inválidos: ${invalid.join(', ')}`;
            await sock.sendMessage(from, { text: msg }, { quoted: m });
            return await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
        }

        if (action === 'add') {
            if (!rest.trim()) {
                await sock.sendMessage(from, { text: `❌ Informe quais adicionar.\nEx.: \`${prefix}subreddit add pics, r/gatos\`` }, { quoted: m });
                return lastBotResponse;
            }
            const { valid, invalid } = parseSubredditInput(rest);
            const fresh = valid.filter(s => !currentSet.has(s));
            const already = valid.filter(s => currentSet.has(s));
            if (valid.length === 0) {
                await sock.sendMessage(from, { text: `❌ Nenhum subreddit válido. Inválidos: ${invalid.join(', ') || rest}` }, { quoted: m });
                return lastBotResponse;
            }
            if (fresh.length === 0) {
                await sock.sendMessage(from, { text: `ℹ️ Todos já estão na lista: ${already.map(s => `r/${s}`).join(', ')}` }, { quoted: m });
                return lastBotResponse;
            }
            if (fresh.length > MAX_PER_CMD) {
                await sock.sendMessage(from, { text: `❌ Máximo ${MAX_PER_CMD} por vez — você mandou ${fresh.length}. Divida em partes.` }, { quoted: m });
                return lastBotResponse;
            }

            await react(sock, m, '⏳', lastBotResponse, GLOBAL_COOLDOWN);
            const ua = cfg.newsUserAgent;
            const added = [];
            const failed = [];
            for (const sub of fresh) {
                let probe;
                try {
                    probe = await probeSubreddit(sub, ua);
                } catch (_) {
                    probe = { ok: false, reason: 'rede' };
                }
                if (probe.ok) added.push(sub);
                else failed.push({ sub, reason: probe.reason || 'rede' });
            }

            let msg = '';
            if (added.length > 0) {
                const next = [...current, ...added];
                config.newsSubreddits = next;
                writeConfig(config);
                restartNewsService(readConfig());
                msg += `✅ *Adicionados (${added.length}):* ${added.map(s => `r/${s}`).join(', ')}\n📚 *Lista agora (${next.length}):* ${next.map(s => `r/${s}`).join(', ')}`;
            }
            if (failed.length > 0) {
                const fmt = failed.map(({ sub, reason }) => {
                    if (reason === 'inexistente') return `r/${sub} (não existe/privado/banido)`;
                    if (reason === 'rate-limit') return `r/${sub} (Reddit limitou — tente de novo em minutos)`;
                    return `r/${sub} (falha de rede — tente de novo)`;
                }).join('\n• ');
                msg += (msg ? '\n\n' : '') + `❌ *Não entraram:*\n• ${fmt}`;
            }
            if (already.length > 0) msg += `\n\nℹ️ Já estavam: ${already.map(s => `r/${s}`).join(', ')}`;
            if (invalid.length > 0) msg += `\n⚠️ Inválidos: ${invalid.join(', ')}`;
            await sock.sendMessage(from, { text: msg || '❌ Nada a fazer.' }, { quoted: m });
            return await react(sock, m, added.length > 0 && failed.length === 0 ? '✅' : failed.length > 0 && added.length === 0 ? '❌' : '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
        }

        await sock.sendMessage(from, { text: usage(prefix) }, { quoted: m });
        return lastBotResponse;
    }
};
