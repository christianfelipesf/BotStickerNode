// Dump automático diário no Telegram.
// Reusa buildDumpZip() (bot.db + .env + uploads) e sendDocument() do telegramBot.
// Agenda: 1x/dia no horário TELEGRAM_DUMP_HOUR (America/Sao_Paulo, padrão 4h).
const fs = require('fs');

const MAX_MB = 45; // limite Bot API = 50MB; margem de segurança

function isDumpEnabled() {
    return process.env.TELEGRAM_DUMP_ENABLED !== '0';
}

function getDumpHour() {
    const h = Number(process.env.TELEGRAM_DUMP_HOUR);
    if (Number.isFinite(h) && h >= 0 && h <= 23) return Math.floor(h);
    return 4;
}

function _spNow() {
    // wall-clock de America/Sao_Paulo como Date
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function msUntilNextRun(hour) {
    const now = _spNow();
    const target = new Date(now);
    target.setHours(hour, 0, 0, 0);
    let diff = target - now;
    if (diff <= 0) diff += 24 * 60 * 60 * 1000;
    return diff;
}

async function sendDailyDump({ reason = 'auto' } = {}) {
    const { buildDumpZip, cleanupDumpZip } = require('./dump');
    const tg = require('./telegramBot');
    let zipPath = null;
    try {
        const { zipPath: built, zipName, includedNames, sizeKb } = buildDumpZip();
        zipPath = built;
        const sizeMb = sizeKb / 1024;
        if (sizeMb > MAX_MB) {
            const msg = `⚠️ *Dump diário pulado:* zip com ${sizeMb.toFixed(1)}MB excede o limite de ${MAX_MB}MB do Telegram.`;
            console.warn(`[dailyDump] ${msg}`);
            try { await tg.send(null, msg); } catch (_) {}
            return { ok: false, reason: 'too-large', sizeKb };
        }
        const buf = fs.readFileSync(zipPath);
        const caption = `📦 *Backup automático diário*\n${includedNames.map(n => `• ${n}`).join('\n')}\n💾 ${sizeKb} KB\n🕐 ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n⚠️ Contém .env com API keys — mantenha em local seguro.`;
        const r = await tg.sendDocument(null, buf, zipName, caption);
        if (r.ok) console.log(`📦 [dailyDump] enviado (${sizeKb} KB, motivo=${reason})`);
        else console.error(`❌ [dailyDump] falha ao enviar: ${r.error}`);
        return { ok: r.ok, sizeKb, error: r.error };
    } catch (e) {
        console.error('❌ [dailyDump] erro:', e?.message || e);
        return { ok: false, error: e?.message || String(e) };
    } finally {
        if (zipPath) {
            try { require('./dump').cleanupDumpZip(zipPath); } catch (_) {}
        }
    }
}

let _started = false;

function startDailyDump() {
    if (_started) return { ok: false, reason: 'already-started' };
    if (!isDumpEnabled()) {
        console.log('📦 [dailyDump] desativado (TELEGRAM_DUMP_ENABLED=0)');
        return { ok: false, reason: 'disabled' };
    }
    let tg;
    try { tg = require('./telegramBot'); } catch (e) {
        console.error('⚠️ [dailyDump] telegramBot indisponível:', e.message);
        return { ok: false, reason: 'no-telegram' };
    }
    // token/chat são resolvidos com lazy-load; só valida no momento do envio.
    // Agenda mesmo assim para não depender de ordem de init.
    const hour = getDumpHour();
    const firstIn = msUntilNextRun(hour);
    const firstAt = new Date(Date.now() + firstIn).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log(`📦 [dailyDump] ativo — 1x/dia às ${String(hour).padStart(2, '0')}h (SP). Próximo: ${firstAt}`);
    const run = async () => {
        try { await sendDailyDump({ reason: 'schedule' }); } catch (_) {}
    };
    const t0 = setTimeout(() => {
        run();
        const t1 = setInterval(run, 24 * 60 * 60 * 1000);
        try { if (t1.unref) t1.unref(); } catch (_) {}
    }, firstIn);
    try { if (t0.unref) t0.unref(); } catch (_) {}
    _started = true;
    return { ok: true, hour, nextInMs: firstIn };
}

module.exports = { startDailyDump, sendDailyDump, msUntilNextRun, isDumpEnabled };
