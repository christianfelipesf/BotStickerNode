// CLI: node src/scripts/sync-supabase.js --init | --push [--force] | --pull | --ping | --schema | --backup-cloud | --status
require('dotenv').config();
const { ensureSupabaseSchema, pingSupabase, isSupabaseEnabled, getRemoteSchema, diffLocalVsRemote } = require('../database/supabaseClient');
const { pushToCloud, pullFromCloud, backupCloud, status, SYNC_TABLES, isSyncKilled } = require('../database/supabaseSync');

async function schemaCheck() {
    const { db } = require('../database/db');
    const remote = await getRemoteSchema();
    if (!remote) {
        console.log('⚠️ Não foi possível ler a spec OpenAPI — confira manualmente no dashboard.');
        return { ok: false };
    }
    const d = diffLocalVsRemote(db, SYNC_TABLES, remote);
    // Exceções de tipo conhecidas (nome igual, tipo divergente de propósito).
    const typeFixes = [];
    const statsValue = remote?.stats?.value;
    if (statsValue && !/string|text/i.test(JSON.stringify(statsValue))) {
        typeFixes.push('ALTER TABLE stats ALTER COLUMN value TYPE TEXT USING value::text;');
    }
    if (!d.missingTables.length && !d.missingColumns.length && !typeFixes.length) {
        console.log('✅ Schema local e nuvem idênticos (tabelas + colunas).');
        return { ok: true, ...d };
    }
    if (d.missingTables.length) {
        console.log('❌ Tabelas ausentes na nuvem:', d.missingTables.join(', '));
        console.log('   Rode src/database/supabaseSchema.sql no SQL Editor (só as tabelas acima, ou o arquivo todo com IF NOT EXISTS).');
    }
    if (d.missingColumns.length) {
        console.log(`❌ ${d.missingColumns.length} coluna(s) ausente(s) na nuvem. Cole isto no SQL Editor:`);
        console.log('--- COPIE DAQUI ---');
        console.log(d.sql);
        console.log('--- ATÉ AQUI ---');
    }
    if (typeFixes.length) {
        console.log('❌ Tipo divergente na nuvem. Cole isto no SQL Editor:');
        console.log('--- COPIE DAQUI ---');
        console.log(typeFixes.join('\n'));
        console.log('--- ATÉ AQUI ---');
    }
    return { ok: false, ...d };
}

async function main() {
    const args = process.argv.slice(2).map(a => String(a).toLowerCase());
    const arg = (args[0] || '--init').toLowerCase();
    const force = args.includes('--force') || args.includes('-f');
    if (!isSupabaseEnabled()) {
        console.error('❌ SUPABASE_URL / SUPABASE_SECRET_KEY ausentes no .env');
        process.exit(1);
    }
    if (isSyncKilled() && ['--init', '--push', '--pull'].includes(arg)) {
        console.warn('⚠️ SUPABASE_SYNC_ENABLED=0 (modo local), mas comando manual segue por ação explícita.');
    }
    if (arg === '--ping') {
        console.log(await pingSupabase());
        return;
    }
    if (arg === '--status') {
        console.log(JSON.stringify({ ...status(), force }));
        return;
    }
    if (arg === '--backup-cloud') {
        const r = await backupCloud();
        console.log('✅ [supabase] backup da nuvem:', JSON.stringify(r));
        return;
    }
    if (arg === '--init' || arg === '--schema') {
        await ensureSupabaseSchema(SYNC_TABLES);
        console.log('✅ [supabase] schema ok na nuvem');
        if (arg === '--init') {
            const r = await pushToCloud({ force: true, requirePull: false });
            console.log('✅ [supabase] carga inicial local → nuvem:', JSON.stringify(r));
        }
        return;
    }
    if (arg === '--push') {
        const r = await pushToCloud({ force, requirePull: false });
        console.log(JSON.stringify(r));
        if (!r.ok && !force) {
            console.log('ℹ️ PUSH recusado pela proteção. Se for intencional, rode: node src/scripts/sync-supabase.js --push --force');
            process.exitCode = 2;
        }
        return;
    }
    if (arg === '--pull') {
        const r = await pullFromCloud();
        console.log(JSON.stringify(r));
        return;
    }
    if (arg === '--check') {
        const r = await schemaCheck();
        if (!r.ok) process.exitCode = 2;
        return;
    }
    console.log('Uso: node src/scripts/sync-supabase.js --init|--push [--force]|--pull|--ping|--schema|--backup-cloud|--status|--check');
}

main().catch(e => { console.error('❌ [supabase] falhou:', e?.message || e); process.exit(1); });
