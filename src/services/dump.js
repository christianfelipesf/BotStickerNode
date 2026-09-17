const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// Arquivos incluídos no dump. .env contém as API keys
// (OPENROUTER_API_KEY, TELEGRAM_BOT_TOKEN, etc.) — incluído por pedido explícito do dono.
const FILES_TO_INCLUDE = [
    'bot.db',
    'bot.db-shm',
    'bot.db-wal',
    'package.json',
    '.env'
];

function buildDumpZip() {
    try { require('../database/utils').flushNow?.(); } catch (_) {}
    try { require('./telegramAlerts').flushNow?.(); } catch (_) {}

    const zip = new AdmZip();
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const zipName = `dump_${Date.now()}.zip`;
    const zipPath = path.join(tempDir, zipName);

    const includedNames = [];
    let missingCount = 0;

    for (const file of FILES_TO_INCLUDE) {
        const filePath = path.join(process.cwd(), file);
        if (fs.existsSync(filePath)) {
            zip.addLocalFile(filePath);
            includedNames.push(file);
        } else {
            missingCount++;
        }
    }

    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (fs.existsSync(uploadsDir)) {
        zip.addLocalFolder(uploadsDir, 'uploads');
    }

    zip.writeZip(zipPath);

    const sizeKb = Math.round(fs.statSync(zipPath).size / 1024);
    const caption = `📦 *Backup Gerado com Sucesso!*\n\n` +
        `📁 *Arquivos incluídos:*\n${includedNames.map(n => `• ${n}`).join('\n')}\n` +
        `📂 *Pasta:* uploads\n\n` +
        `💾 *Tamanho:* ${sizeKb} KB\n` +
        `⚠️ *Contém .env com API keys — mantenha em local seguro.*`;

    return { zipPath, zipName, includedNames, missingCount, sizeKb, caption };
}

function cleanupDumpZip(zipPath) {
    try { if (zipPath && fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch (_) {}
}

module.exports = { buildDumpZip, cleanupDumpZip, FILES_TO_INCLUDE };
