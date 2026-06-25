const fs = require('fs');
const path = require('path');

const tempDir = path.join(process.cwd(), 'temp');
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

function cleanTemp(maxAgeMs = DEFAULT_MAX_AGE_MS) {
    if (!fs.existsSync(tempDir)) return 0;

    const now = Date.now();
    let cleaned = 0;
    let totalBytes = 0;

    try {
        const entries = fs.readdirSync(tempDir, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name === '.gitkeep') continue;
            const fullPath = path.join(tempDir, entry.name);

            try {
                const stat = fs.statSync(fullPath);
                if (now - stat.mtimeMs > maxAgeMs) {
                    if (entry.isDirectory()) {
                        const size = getDirSize(fullPath);
                        fs.rmSync(fullPath, { recursive: true, force: true });
                        totalBytes += size;
                    } else {
                        totalBytes += stat.size;
                        fs.unlinkSync(fullPath);
                    }
                    cleaned++;
                }
            } catch (_) {}
        }
    } catch (e) {
        console.error('❌ [tempCleanup] erro ao ler temp/:', e.message);
    }

    if (cleaned > 0) {
        const freed = totalBytes > 1048576
            ? `${(totalBytes / 1048576).toFixed(1)} MB`
            : `${Math.round(totalBytes / 1024)} KB`;
        console.log(`🧹 [tempCleanup] ${cleaned} arquivo(s) removido(s) (${freed} liberados)`);
    }

    return cleaned;
}

function getDirSize(dirPath) {
    let total = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            try {
                if (entry.isDirectory()) {
                    total += getDirSize(fullPath);
                } else {
                    total += fs.statSync(fullPath).size;
                }
            } catch (_) {}
        }
    } catch (_) {}
    return total;
}

function startTempCleanup(intervalMs = DEFAULT_INTERVAL_MS, maxAgeMs = DEFAULT_MAX_AGE_MS) {
    const cleaned = cleanTemp(maxAgeMs);

    const timer = setInterval(() => {
        cleanTemp(maxAgeMs);
    }, intervalMs);

    if (typeof timer.unref === 'function') timer.unref();

    console.log(`🧹 [tempCleanup] automático a cada ${Math.round(intervalMs / 60000)}min (arquivos > ${Math.round(maxAgeMs / 60000)}min)`);

    return timer;
}

module.exports = { cleanTemp, startTempCleanup };
