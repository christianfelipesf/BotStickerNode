// Bundle de auditoria p/ bug-hunting: recorta a trilha de um bug em 1 .md.
// Uso:
//   node src/scripts/audit-bundle.js --cid <message_id>
//   node src/scripts/audit-bundle.js --cmd !play --since 2h [--group <jid>] [--limit 200]
//   --since aceita: 30m, 2h, 24h, 7d (default 24h)
// Saída: temp/audit_<ts>.md (esse arquivo é o que se anexa ao pedido de debug)
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const out = { since: '24h', limit: 200 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--cid') out.cid = argv[++i];
        else if (a === '--cmd') out.cmd = String(argv[++i] || '').replace(/^!/, '');
        else if (a === '--since') out.since = argv[++i] || '24h';
        else if (a === '--group') out.group = argv[++i];
        else if (a === '--limit') out.limit = Math.max(1, Math.min(2000, Number(argv[++i]) || 200));
        else if (a === '--help' || a === '-h') out.help = true;
    }
    return out;
}

function parseSince(s) {
    const m = String(s || '24h').match(/^(\d+)\s*([mhd])$/i);
    if (!m) return 24 * 3600 * 1000;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === 'm') return n * 60 * 1000;
    if (unit === 'h') return n * 3600 * 1000;
    return n * 24 * 3600 * 1000;
}

function readAgentEvents(logsDir, cutoffMs) {
    const events = [];
    let files = [];
    try { files = fs.readdirSync(logsDir).filter(f => /^agent_\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); }
    catch (_) { return { events, files: [] }; }
    // Só arquivos com mtime >= cutoff (rápido, evita ler 30d)
    const fresh = files.filter(f => {
        try { return fs.statSync(path.join(logsDir, f)).mtimeMs >= cutoffMs - 24 * 3600 * 1000; }
        catch (_) { return true; }
    });
    for (const f of fresh) {
        let content = '';
        try { content = fs.readFileSync(path.join(logsDir, f), 'utf8'); } catch (_) { continue; }
        for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            let ev = null;
            try { ev = JSON.parse(line); } catch (_) { continue; }
            const ts = Date.parse(ev.ts_utc || '');
            if (Number.isFinite(ts) && ts < cutoffMs) continue;
            events.push({ ...ev, _file: f });
        }
    }
    events.sort((a, b) => String(a.ts_utc).localeCompare(String(b.ts_utc)));
    return { events, files: fresh };
}

function queryDashboardLogs(cutoffMs, { cid, group, limit }) {
    try {
        const dbPath = path.join(process.cwd(), 'bot.db');
        if (!fs.existsSync(dbPath)) return { rows: [], note: 'bot.db ausente' };
        const db = require('better-sqlite3')(dbPath, { readonly: true });
        try {
            let rows;
            if (cid) {
                rows = db.prepare('SELECT type,grp,text,name,phone,to_jid,message_id,sender_jid,from_me,timestamp FROM dashboard_logs WHERE message_id = ? ORDER BY timestamp ASC LIMIT 50').all(cid);
            } else if (group) {
                rows = db.prepare('SELECT type,grp,text,name,phone,to_jid,message_id,sender_jid,from_me,timestamp FROM dashboard_logs WHERE to_jid = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?').all(group, cutoffMs, limit);
            } else {
                rows = db.prepare('SELECT type,grp,text,name,phone,to_jid,message_id,sender_jid,from_me,timestamp FROM dashboard_logs WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?').all(cutoffMs, limit);
            }
            return { rows };
        } finally { try { db.close(); } catch (_) {} }
    } catch (e) {
        return { rows: [], note: 'falha ao ler bot.db: ' + e.message };
    }
}

function gitVersion() {
    try {
        const { execFileSync } = require('child_process');
        return execFileSync('git', ['log', '-1', '--format=%h %s'], { windowsHide: true }).toString().trim();
    } catch (_) { return 'indisponível'; }
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || (!args.cid && !args.cmd && !args.group)) {
        console.log('Uso:');
        console.log('  node src/scripts/audit-bundle.js --cid <message_id>');
        console.log('  node src/scripts/audit-bundle.js --cmd !play --since 2h [--group <jid>] [--limit 200]');
        process.exit(args.help ? 0 : 1);
    }
    const windowMs = parseSince(args.since);
    const cutoffMs = Date.now() - windowMs;
    const logsDir = path.join(process.cwd(), 'logs');

    const { events, files } = readAgentEvents(logsDir, cutoffMs);
    let filtered = events;
    if (args.cid) filtered = filtered.filter(e => e.cid === args.cid);
    if (args.cmd) filtered = filtered.filter(e => String(e.cmd || '').toLowerCase() === String(args.cmd).toLowerCase());
    if (args.group) filtered = filtered.filter(e => e.from === args.group || e.group === args.group);
    filtered = filtered.slice(-args.limit);

    const dash = queryDashboardLogs(cutoffMs, { cid: args.cid, group: args.group, limit: Math.min(args.limit, 200) });

    let aiModel = '', prefix = '';
    try {
        const utils = require('../database/utils');
        const cfg = utils.readConfig ? utils.readConfig() : {};
        aiModel = cfg.aiModel || ''; prefix = cfg.prefix || '!';
    } catch (_) {}

    const fails = filtered.filter(e => !e.ok);
    const cmds = {};
    for (const e of filtered) cmds[e.cmd || '?'] = (cmds[e.cmd || '?'] || 0) + 1;

    const out = [];
    out.push(`# Audit bundle — ${new Date().toISOString()}`);
    out.push('');
    out.push(`- Filtro: ${args.cid ? `cid=${args.cid}` : `cmd=${args.cmd ? '!' + args.cmd : '*'} since=${args.since} group=${args.group || '*'}`}`);
    out.push(`- Janela: desde ${new Date(cutoffMs).toISOString()} (${args.since})`);
    out.push(`- Versão: ${gitVersion()} | aiModel=${aiModel} | prefix=${prefix}`);
    out.push(`- Eventos: ${filtered.length} (falhas: ${fails.length}) | por comando: ${JSON.stringify(cmds)}`);
    out.push(`- Arquivos agent lidos: ${files.join(', ') || 'nenhum'}`);
    out.push('');
    out.push('## Eventos (agent_*.jsonl)');
    if (!filtered.length) out.push('_nenhum evento no filtro/janela — verifique --since maior ou o cid_');
    for (const e of filtered.slice(-100)) out.push('```json\n' + JSON.stringify(e) + '\n```');
    out.push('');
    out.push('## Dashboard logs (bot.db, janela)');
    if (dash.note) out.push(`_${dash.note}_`);
    else if (!dash.rows.length) out.push('_sem linhas_');
    for (const r of (dash.rows || []).slice(0, 100)) {
        out.push(`- [${new Date(r.timestamp).toISOString()}] [${r.type}] ${r.grp || r.to_jid || ''} :: ${(r.text || '').slice(0, 200)} (msg=${r.message_id || '-'})`);
    }
    out.push('');
    out.push('_Fonte primária p/ bugs: agent_*.jsonl (1 linha por execução, join por cid). Terminal completo excluído do bundle (GBs de noise)._');

    const tempDir = path.join(process.cwd(), 'temp');
    try { if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true }); } catch (_) {}
    const outPath = path.join(tempDir, `audit_${Date.now()}.md`);
    fs.writeFileSync(outPath, out.join('\n'));
    console.log(`✅ bundle em ${outPath} (${filtered.length} eventos, ${fails.length} falhas)`);
}

if (require.main === module) main();
module.exports = { parseArgs, parseSince };
