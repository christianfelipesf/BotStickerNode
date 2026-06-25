const fs = require('fs');
const path = require('path');
const os = require('os');

const ACCESS_LOG = path.join(process.cwd(), 'logs', 'access.log');

function parseAccessLog() {
    if (!fs.existsSync(ACCESS_LOG)) return { entries: [], byClient: [], totalRequests: 0 };
    let raw = '';
    try { raw = fs.readFileSync(ACCESS_LOG, 'utf8'); } catch (_) { return { entries: [], byClient: [], totalRequests: 0 }; }

    const lines = raw.split(/\r?\n/).filter(Boolean);
    const entries = [];
    for (const line of lines) {
        const m = line.match(/^\[([^\]]+)\]\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d{3})\s+\S+\s+ua="([^"]*)"\s+ref="([^"]*)"/);
        if (!m) continue;
        entries.push({
            ts: m[1],
            ip: m[2],
            method: m[3],
            url: m[4],
            status: Number(m[5]),
            ua: m[6] || '',
            ref: m[7] || ''
        });
    }

    const byClient = new Map();
    for (const e of entries) {
        const key = `${e.ip}||${normalizeUA(e.ua)}`;
        let slot = byClient.get(key);
        if (!slot) {
            slot = {
                ip: e.ip,
                ua: e.ua,
                uaShort: shortUA(e.ua),
                firstAt: e.ts,
                lastAt: e.ts,
                hits: 0,
                lastUrls: []
            };
            byClient.set(key, slot);
        }
        slot.hits += 1;
        if (e.ts < slot.firstAt) slot.firstAt = e.ts;
        if (e.ts > slot.lastAt) slot.lastAt = e.ts;
        slot.lastUrls.push({ ts: e.ts, url: e.url, status: e.status });
        if (slot.lastUrls.length > 5) slot.lastUrls.shift();
    }

    const arr = Array.from(byClient.values()).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return { entries, byClient: arr, totalRequests: entries.length };
}

function normalizeUA(ua) {
    return String(ua || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function shortUA(ua) {
    const s = String(ua || '').trim();
    if (!s || s === '-') return 'desconhecido';
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

function fmtTs(iso) {
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleString('pt-BR');
    } catch (_) { return iso; }
}

function buildReport({ byClient, totalRequests }) {
    const header = [
        `# Dashboard — Lista de conexões`,
        `# Gerado em: ${new Date().toLocaleString('pt-BR')}`,
        `# Total de requisições: ${totalRequests}`,
        `# Clientes únicos: ${byClient.length}`,
        `# Origem do log: ${ACCESS_LOG}`,
        `# Host: ${os.hostname()} • ${process.platform}`,
        ''
    ];

    if (byClient.length === 0) {
        return header.concat([
            '(nenhuma conexão registrada em logs/access.log ainda — abra o dashboard uma vez para gerar entradas)'
        ]).join('\n');
    }

    const rows = byClient.map((c, i) => {
        const ua = c.uaShort || '-';
        const lastUrls = (c.lastUrls || []).slice(-3).map(u => `   • ${u.ts}  ${u.method} ${u.url}  → ${u.status}`).join('\n');
        return [
            `#${String(i + 1).padStart(3, '0')}  ${c.ip}`,
            `   UA        : ${ua}`,
            `   Primeira  : ${fmtTs(c.firstAt)}`,
            `   Última    : ${fmtTs(c.lastAt)}`,
            `   Hits      : ${c.hits}`,
            lastUrls ? `   Últimos   :\n${lastUrls}` : ''
        ].filter(Boolean).join('\n');
    });

    return header.concat(rows).join('\n\n') + '\n';
}

module.exports = {
    parseAccessLog,
    buildReport,
    ACCESS_LOG
};
