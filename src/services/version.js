const { fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const CACHE_TTL = 60 * 60 * 1000;

let cachedVersion = null;
let cachedAt = 0;

function normalizeVersion(v) {
    // Baileys espera array [major, minor, patch]. Versões novas do fetchLatest
    // podem vir como string "2.3000.x" — converte para array.
    if (Array.isArray(v) && v.length === 3 && v.every(n => Number.isInteger(n))) return v;
    if (typeof v === 'string') {
        const parts = v.split('.').map(Number);
        if (parts.length === 3 && parts.every(n => Number.isInteger(n))) return parts;
    }
    return null;
}

async function getCachedBaileysVersion() {
    const now = Date.now();
    if (cachedVersion && (now - cachedAt) < CACHE_TTL) {
        return cachedVersion;
    }
    try {
        const latest = await fetchLatestBaileysVersion();
        cachedVersion = normalizeVersion(latest?.version) || cachedVersion || [2, 3000, 1017531287];
        cachedAt = Date.now();
    } catch (_) {
        if (!cachedVersion) cachedVersion = [2, 3000, 1017531287];
        cachedAt = Date.now();
    }
    return cachedVersion;
}

module.exports = { getCachedBaileysVersion };
