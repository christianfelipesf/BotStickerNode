// subConnLog — log detalhado de conexão/desconexão/reconexão das sub-sessões.
// Salva em logs/subs/subs_YYYY-MM-DD.log (uma linha por evento).
// Uso: connlog(ownerJidOuHash, evento, detalhe)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUB_LOGS_DIR = path.join(process.cwd(), 'logs', 'subs');

function ensureDir() {
    try { fs.mkdirSync(SUB_LOGS_DIR, { recursive: true }); } catch (_) {}
}

function dayLabel(d = new Date()) {
    try { return d.toISOString().slice(0, 10); } catch (_) { return 'unknown'; }
}

function tsLabel(d = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    try {
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    } catch (_) { return '??:??:??'; }
}

function shortHash(ownerJid) {
    try {
        const s = String(ownerJid || '');
        if (/^[0-9a-f]{16}$/.test(s)) return s;
        return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
    } catch (_) { return '?'; }
}

function fileFor(d = new Date()) {
    ensureDir();
    return path.join(SUB_LOGS_DIR, `subs_${dayLabel(d)}.log`);
}

// evento: ex 'restore-try', 'open', 'close', 'recreate', 'notify-ok', 'notify-fail'
function connlog(ownerJid, evento, detalhe) {
    try {
        ensureDir();
        const now = new Date();
        const hash = shortHash(ownerJid);
        const line = `[${tsLabel(now)}] [${hash}] ${evento}${detalhe ? ' ' + String(detalhe).replace(/\s+/g, ' ').slice(0, 500) : ''}\n`;
        fs.appendFileSync(fileFor(now), line, 'utf8');
    } catch (_) {}
}

function getLogsDir() { return SUB_LOGS_DIR; }

module.exports = { connlog, getLogsDir, shortHash };
