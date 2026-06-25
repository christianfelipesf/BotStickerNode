const { fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const CACHE_TTL = 60 * 60 * 1000;

let cachedVersion = null;
let cachedAt = 0;

async function getCachedBaileysVersion() {
    const now = Date.now();
    if (cachedVersion && (now - cachedAt) < CACHE_TTL) {
        return cachedVersion;
    }
    try {
        const latest = await fetchLatestBaileysVersion();
        if (latest?.version && Array.isArray(latest.version) && latest.version.length === 3) {
            cachedVersion = latest.version;
        } else if (latest?.version) {
            cachedVersion = latest.version;
        }
        cachedAt = Date.now();
    } catch (_) {
        if (!cachedVersion) cachedVersion = [2, 3000, 1017531287];
        cachedAt = Date.now();
    }
    return cachedVersion;
}

module.exports = { getCachedBaileysVersion };
