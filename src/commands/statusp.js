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

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: `timeout ${ms}ms (${label})` }), ms)),
    ]);
}

async function checkSupabasePing() {
    const t0 = process.hrtime.bigint();
    try {
        const { isSupabaseEnabled, pingSupabase } = require('../database/supabaseClient');
        if (!isSupabaseEnabled()) return { configured: false };
        const ping = await withTimeout(pingSupabase(), 8000, 'supabase');
        const t1 = process.hrtime.bigint();
        const ms = Math.round(Number(t1 - t0) / 1e6);
        return { configured: true, ping, ms };
    } catch (e) {
        const t1 = process.hrtime.bigint();
        const ms = Math.round(Number(t1 - t0) / 1e6);
        return { configured: true, ping: { ok: false, reason: (e?.message || String(e)).slice(0, 120) }, ms };
    }
}

module.exports = {
    name: 'statusp',
    aliases: [],
    category: 'geral',
    description: 'Resumo do modo parcial + ping e ping do banco (funciona no parcial)',
    async execute(sock, m, { from, isGroup, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, getGroupData, getThemeForJid, isPartialActive, getPartialWaitMs, isActiveGroup } = utils;
        const { getTheme, themeBullets } = require('../services/themes');
        const themeId = (typeof getThemeForJid === 'function' ? getThemeForJid(from) : ((getGroupData(from).theme) || 'default'));
        const theme = getTheme(themeId);
        const B = theme.bullet || '│';

        let currentBotResponse = await react(sock, m, theme.react || '🟡', lastBotResponse, GLOBAL_COOLDOWN);

        const t0 = process.hrtime.bigint();
        const google = await measureGooglePing();
        const t1 = process.hrtime.bigint();
        const respostaMs = Math.round(Number(t1 - t0) / 1e6);
        const botName = getBotName(from, config);

        // --- Modo parcial: resumo pequeno ---
        let parcialAtivo = false;
        let waitSec = 0;
        try { parcialAtivo = isGroup ? !!isPartialActive(from) : false; } catch (_) {}
        try { waitSec = Math.round((getPartialWaitMs() || 10000) / 1000); } catch (_) { waitSec = 10; }
        let totalAtivo = false;
        try { totalAtivo = isGroup ? !!isActiveGroup(from) : true; } catch (_) {}

        const modoTxt = !isGroup
            ? 'PV (parcial só vale em grupo)'
            : parcialAtivo ? `🟡 ATIVO neste grupo (espera ${waitSec}s)` : totalAtivo ? '🟢 Total (não está em parcial)' : '🔴 Desligado';

        // --- Banco de dados: apenas modo + ping da nuvem ---
        let syncMode = null;
        try {
            const sync = require('../database/supabaseSync');
            syncMode = (typeof sync.getMode === 'function') ? sync.getMode() : sync.status();
        } catch (_) { syncMode = null; }
        const supa = await checkSupabasePing();

        const isLocal = !supa.configured || !!(syncMode && syncMode.local);
        const modoLinha = `${B} 📦 *Modo:* ${isLocal ? '📀 LOCAL' : '☁️ REMOTO'}`;

        let nuvemLinha;
        if (!supa.configured) {
            nuvemLinha = `${B} ☁️ *Ping nuvem:* desativado`;
        } else if (supa.ping && supa.ping.ok) {
            const w = supa.ping.warning ? ` ⚠️ ${supa.ping.warning}` : '';
            nuvemLinha = `${B} ☁️ *Ping nuvem:* ${supa.ms}ms ✅${w}`;
        } else {
            const r = ((supa.ping && (supa.ping.reason || supa.ping.warning)) || 'sem resposta');
            nuvemLinha = `${B} ☁️ *Ping nuvem:* falha (${String(r).slice(0, 100)}) ${theme.err || '❌'}`;
        }

        const googleLinha = google.ok
            ? `${B} 🌐 *Google:* ${google.ms}ms ${classifyPing(google.ms)}`
            : `${B} 🌐 *Google:* falha (${google.error || 'sem resposta'}) ${theme.err || '❌'}`;

        const statusLinha = google.ok
            ? classifyPing(google.ms).includes('❌') ? `${B} 📡 *Status:* Instável ⚠️` : `${B} 📡 *Status:* Online ${theme.ok || '✅'}`
            : `${B} 📡 *Status:* Offline ${theme.err || '❌'}`;

        let pingText = `*${botName} — Status Parcial* 🟡\n_resumo rápido_\n\n` +
            `╭─── *MODO PARCIAL* ───\n` +
            `${B} 🟡 *Parcial:* ${modoTxt}\n` +
            `${B} 🎬 *Liberado:* mídia + interação + !tts\n` +
            `${B} 🛡️ *Moderação:* pausada no parcial\n` +
            `╰───────────────\n\n` +
            `╭─── *LATÊNCIA* ───\n` +
            `${B} ⚡ *Resposta:* ${respostaMs}ms\n` +
            `${googleLinha}\n` +
            `${statusLinha}\n` +
            `╰───────────────\n\n` +
            `╭─── *BANCO DE DADOS* ───\n` +
            `${modoLinha}\n` +
            `${nuvemLinha}\n` +
            `╰───────────────`;
        pingText = themeBullets(pingText, theme);

        await sock.sendMessage(from, { text: pingText }, { quoted: m });

        return currentBotResponse;
    }
};
