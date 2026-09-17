// CLI: node src/scripts/sync-turso.js --init | --push [--force] | --pull | --ping | --schema | --backup-cloud | --status
require('dotenv').config();
const { ensureTursoSchema, pingTurso, isTursoEnabled } = require('../database/tursoClient');
const { pushToCloud, pullFromCloud, backupCloud, status } = require('../database/tursoSync');

async function main() {
    const args = process.argv.slice(2).map(a => String(a).toLowerCase());
    const arg = (args[0] || '--init').toLowerCase();
    const force = args.includes('--force') || args.includes('-f');
    if (!isTursoEnabled()) {
        console.error('❌ TURSO_DATABASE_URL / TURSO_AUTH_TOKEN ausentes no .env');
        process.exit(1);
    }
    if (arg === '--ping') {
        console.log(await pingTurso());
        return;
    }
    if (arg === '--status') {
        console.log(JSON.stringify({ ...status(), force }));
        return;
    }
    if (arg === '--backup-cloud') {
        const r = await backupCloud();
        console.log('✅ [turso] backup da nuvem:', JSON.stringify(r));
        return;
    }
    if (arg === '--init' || arg === '--schema') {
        await ensureTursoSchema();
        console.log('✅ [turso] schema garantido na nuvem');
        if (arg === '--init') {
            const r = await pushToCloud({ force: true, requirePull: false });
            console.log('✅ [turso] carga inicial local → nuvem:', JSON.stringify(r));
        }
        return;
    }
    if (arg === '--push') {
        // Push manual: pula a trava de boot (processo próprio, sem PULL),
        // mas mantém a validação de sanidade — use --force só se intencional.
        const r = await pushToCloud({ force, requirePull: false });
        console.log(JSON.stringify(r));
        if (!r.ok && !force) {
            console.log('ℹ️ PUSH recusado pela proteção. Se for intencional, rode: node src/scripts/sync-turso.js --push --force');
            process.exitCode = 2;
        }
        return;
    }
    if (arg === '--pull') {
        const r = await pullFromCloud();
        console.log(JSON.stringify(r));
        return;
    }
    console.log('Uso: node src/scripts/sync-turso.js --init|--push [--force]|--pull|--ping|--schema|--backup-cloud|--status');
}

main().catch(e => { console.error('❌ [turso] falhou:', e?.message || e); process.exit(1); });
