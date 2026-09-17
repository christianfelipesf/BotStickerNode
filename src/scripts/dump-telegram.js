// CLI: node src/scripts/dump-telegram.js [--dry] [--send]
// --dry (padrão): só gera o zip e mostra tamanho, sem enviar.
// --send: envia de verdade para o chat do Telegram (cuidado: contém .env).
require('dotenv').config();

async function main() {
    const args = process.argv.slice(2).map(a => String(a).toLowerCase());
    if (args.includes('--send')) {
        const { sendDailyDump } = require('../services/dailyDump');
        const r = await sendDailyDump({ reason: 'manual' });
        console.log(JSON.stringify(r));
        if (!r.ok) process.exitCode = 1;
        return;
    }
    // --dry: monta o zip, mede, limpa, não envia
    const { buildDumpZip, cleanupDumpZip } = require('../services/dump');
    const { zipPath, zipName, includedNames, sizeKb } = buildDumpZip();
    console.log(JSON.stringify({ zipName, includedNames, sizeKb }));
    cleanupDumpZip(zipPath);
    console.log('✅ [dump] dry-run ok (zip gerado e limpo, nada enviado)');
}

main().catch(e => { console.error('❌ [dump] falhou:', e?.message || e); process.exit(1); });
