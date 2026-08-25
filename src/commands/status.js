const https = require('https');

function httpsPing(timeoutMs = 5000) {
    return new Promise((resolve) => {
        const start = process.hrtime.bigint();
        const req = https.request({
            hostname: 'www.google.com',
            path: '/generate_204',
            method: 'HEAD',
            timeout: timeoutMs,
        }, (res) => {
            const end = process.hrtime.bigint();
            const ms = Math.round(Number(end - start) / 1e6);
            res.resume();
            resolve({ ok: true, ms });
        });
        req.on('error', (e) => resolve({ ok: false, ms: null, error: e.message }));
        req.on('timeout', () => {
            req.destroy(new Error('timeout'));
            resolve({ ok: false, ms: null, error: 'timeout' });
        });
        req.end();
    });
}

async function measureGooglePing() {
    if (typeof fetch === 'function') {
        try {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 5000);
            const start = process.hrtime.bigint();
            const res = await fetch('https://www.google.com/generate_204', {
                method: 'HEAD',
                signal: controller.signal,
                cache: 'no-store',
            });
            clearTimeout(t);
            const end = process.hrtime.bigint();
            const ms = Math.round(Number(end - start) / 1e6);
            if (res && (res.ok || res.status === 204 || res.status === 200 || res.status === 301 || res.status === 302)) {
                return { ok: true, ms };
            }
        } catch (_) {}
    }
    const r = await httpsPing(5000);
    if (r.ok) return r;
    return new Promise((resolve) => {
        const start = process.hrtime.bigint();
        const req = https.request({ hostname: 'www.google.com', path: '/', method: 'HEAD', timeout: 5000 }, (res) => {
            const end = process.hrtime.bigint();
            const ms = Math.round(Number(end - start) / 1e6);
            res.resume();
            resolve({ ok: true, ms });
        });
        req.on('error', (e) => resolve({ ok: false, ms: null, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, ms: null, error: 'timeout' }); });
        req.end();
    });
}

function classifyPing(ms) {
    if (ms == null) return '❌ Offline';
    if (ms < 100) return '✅ Excelente';
    if (ms < 200) return '✅ Bom';
    if (ms < 400) return '⚠️ Médio';
    return '🐢 Lento';
}

module.exports = {
    name: 'status',
    aliases: [],
    category: 'geral',
    description: 'Verifica latência real com o Google',
    async execute(sock, m, { from, config, utils, lastBotResponse, GLOBAL_COOLDOWN, startTime }) {
        const { react, getBotName, formatUptime, readStats, getVersion } = utils;

        let currentBotResponse = await react(sock, m, '🏓', lastBotResponse, GLOBAL_COOLDOWN);

        const t0 = process.hrtime.bigint();
        const google = await measureGooglePing();
        const t1 = process.hrtime.bigint();
        const respostaMs = Math.round(Number(t1 - t0) / 1e6);
        const botName = getBotName(from, config);
        const stats = readStats();
        const version = getVersion();
        const uptime = formatUptime((Date.now() - startTime) / 1000);
        const plataforma = process.platform === 'win32' ? 'Windows' : 'Linux';

        const googleLinha = google.ok
            ? `│ 🌐 *Google:* ${google.ms}ms ${classifyPing(google.ms)}`
            : `│ 🌐 *Google:* falha (${google.error || 'sem resposta'}) ❌`;

        const statusLinha = google.ok
            ? classifyPing(google.ms).includes('❌') ? '│ 📡 *Status:* Instável ⚠️' : '│ 📡 *Status:* Online ✅'
            : '│ 📡 *Status:* Offline ❌';

        const pingText = `*${botName} — Ping* 🏓\n_teste de conexão_\n\n` +
            `╭─── *LATÊNCIA* ───\n` +
            `│ ⚡ *Resposta:* ${respostaMs}ms\n` +
            `${googleLinha}\n` +
            `${statusLinha}\n` +
            `╰───────────────\n\n` +
            `╭─── *SISTEMA* ───\n` +
            `│ ⏱️ *Uptime:* ${uptime}\n` +
            `│ 🖥️ *Plataforma:* ${plataforma}\n` +
            `│ 🆔 *Versão:* ${version}\n` +
            `│ ⌨️ *Comandos:* ${stats.totalCommands}\n` +
            `│ 🔄 *Reinícios:* ${stats.restarts}\n` +
            `╰───────────────`;

        // !status envia apenas texto, sem imagem
        await sock.sendMessage(from, { text: pingText }, { quoted: m });

        return currentBotResponse;
    }
};
