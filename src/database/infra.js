// Helpers puros de infra (sem banco).
// Extraído de src/database/utils.js (quebra parcial).
'use strict';

const { execFileSync } = require('child_process');

function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

let _cachedVersion = null;
function getVersion() {
    if (_cachedVersion) return _cachedVersion;
    try { _cachedVersion = execFileSync('git', ['log', '-1', '--format=%h %s'], { windowsHide: true }).toString().trim() || 'v1.0.0'; } catch (_) { _cachedVersion = 'v1.0.0'; }
    return _cachedVersion;
}

module.exports = {
    formatUptime,
    getVersion,
};
