// One-shot: troca nome de ficha que é JID/número/menção pelo nome real (push_name do log).
// Uso: node src/scripts/fix-fichas-jid.js [--dry] [--apply]
// --dry (padrão): só mostra o mapeamento, não altera nada.
// --apply: renomeia (UPDATE nome+nome_norm, resto da ficha intacto).
require('dotenv').config();
const { db } = require('../database/db');
const { isValidPessoaNome, normalizeNome } = require('../services/ficha');

function latestLogName(lidDigits) {
    try {
        const r = db.prepare(
            'SELECT name FROM dashboard_logs WHERE sender_jid = ? ORDER BY timestamp DESC LIMIT 1'
        ).get(`${lidDigits}@lid`);
        return r ? r.name : null;
    } catch (_) { return null; }
}

function plan() {
    const rows = db.prepare('SELECT nome, nome_norm FROM pessoas ORDER BY nome').all();
    const taken = new Set(rows.map(r => r.nome_norm));
    const out = [];
    for (const p of rows) {
        if (isValidPessoaNome(p.nome).ok) continue;
        const key = String(p.nome).replace(/^@+/, '').trim();
        let candidate = null;
        let source = null;
        if (/^\d{8,16}$/.test(key)) {
            candidate = latestLogName(key);
            source = candidate ? 'dashboard_logs push_name' : null;
        } else if (key && !key.includes('@')) {
            candidate = key; // ex: "@Nathan Vesalā" → nome direto
            source = 'menção direta';
        }
        candidate = candidate ? String(candidate).trim().slice(0, 40) : null;
        const valid = candidate ? isValidPessoaNome(candidate) : null;
        const norm = candidate ? normalizeNome(candidate) : null;
        const conflict = norm && norm !== p.nome_norm && taken.has(norm);
        out.push({
            de: p.nome,
            para: candidate,
            source,
            aplicavel: !!(candidate && valid && valid.ok && norm && !conflict),
            motivo: !candidate ? 'sem nome encontrado (sem registro no log)' : (!valid.ok ? `nome do log inválido: ${valid.reason}` : (conflict ? `conflito: já existe ficha "${candidate}"` : 'ok')),
        });
    }
    return out;
}

function apply(items) {
    const upd = db.prepare('UPDATE pessoas SET nome = ?, nome_norm = ?, updated_at = ? WHERE nome_norm = ?');
    let ok = 0;
    for (const it of items) {
        if (!it.aplicavel) continue;
        const fromNorm = normalizeNome(String(it.de).replace(/^@+/, '').trim()) && db.prepare('SELECT nome_norm FROM pessoas WHERE nome = ?').get(it.de)?.nome_norm;
        if (!fromNorm) continue;
        const r = upd.run(it.para, normalizeNome(it.para), Date.now(), fromNorm);
        if (r.changes > 0) ok++;
    }
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
    return ok;
}

async function main() {
    const args = process.argv.slice(2).map(a => String(a).toLowerCase());
    const items = plan();
    console.log(`Fichas com JID/número no nome: ${items.length}`);
    for (const it of items) {
        console.log(` - ${JSON.stringify(it.de)} → ${it.para ? JSON.stringify(it.para) : '(?)'} [${it.source || 'sem fonte'}] ${it.aplicavel ? '✅' : '⏭️ ' + it.motivo}`);
    }
    const n = items.filter(i => i.aplicavel).length;
    if (args.includes('--apply')) {
        const ok = apply(items);
        console.log(`✅ Renomeadas ${ok}/${n} fichas (resto da ficha preservado; sincroniza com a nuvem no próximo push).`);
    } else {
        console.log(`ℹ️ Dry-run: ${n} renomeáveis. Rode com --apply para efetivar.`);
    }
}

main().catch(e => { console.error('❌ falhou:', e?.message || e); process.exit(1); });
