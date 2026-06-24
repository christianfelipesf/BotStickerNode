const fs = require('fs');
const path = require('path');

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    try { fs.mkdirSync(logsDir, { recursive: true }); } catch (_) {}
}

const RING_MAX = 50;
const ring = [];

const _LIB_PATTERNS = [
    /Closing (open )?session/i,
    /Closing session:/i,
    /SessionEntry\s*\{/i,
    /chainKey:/i,
    /ephemeralKeyPair/i,
    /lastRemoteEphemeralKey/i,
    /remoteIdentityKey/i,
    /indexInfo/i,
    /messageKeys/i,
    /registrationId/i,
    /currentRatchet/i,
    /baseKey/i,
    /Failed to decrypt message with any known session/i,
    /Session error:/i,
    /Bad MAC\s*Error/i,
    /verifyMAC/i,
    /doDecryptWhisperMessage/i,
    /decryptWithSessions/i,
    /\[as awaitable\]/i,
    /_asyncQueueExecutor/i,
    /libsignal/i,
    /crypto\.js/i,
    /session_cipher\.js/i,
    /queue_job\.js/i,
    /at\s+Object\./i,
    /at\s+SessionCipher/i,
    /at\s+async\s+[\d.]+\s*\[as awaitable\]/i,
    /Buffer\s+[0-9a-f]{2}\s+[0-9a-f]{2}/i,
];
const _isLibsignalNoise = (str) => _LIB_PATTERNS.some(re => re.test(str));

function pad(n) { return String(n).padStart(2, '0'); }

function tsLabel(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fileLabel(d) {
    return d.toISOString().slice(0, 10);
}

function getSessionLogFile(d) {
    return path.join(logsDir, `terminal_${fileLabel(d)}.log`);
}

function serialize(args) {
    try {
        return args.map(a => {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch (_) { return String(a); }
        }).join(' ');
    } catch (_) {
        return String(args);
    }
}

function push(level, args) {
    const text = serialize(args);
    if (!text) return;
    if (_isLibsignalNoise(text)) return;
    const now = new Date();
    const entry = {
        ts: now.getTime(),
        time: tsLabel(now),
        level,
        text
    };
    ring.push(entry);
    if (ring.length > RING_MAX) ring.shift();
    try {
        const line = `[${tsLabel(now)}] [${level.toUpperCase()}] ${text}\n`;
        fs.appendFileSync(getSessionLogFile(now), line);
    } catch (_) {}
}

function getLast(n = 15) {
    const limit = Math.max(1, Math.min(RING_MAX, Number(n) || 15));
    return ring.slice(-limit);
}

function getBufferSize() { return ring.length; }
function getRingMax() { return RING_MAX; }
function getLogsDir() { return logsDir; }

let initialized = false;
function init() {
    if (initialized) return;
    initialized = true;

    const wrap = (level, orig) => function (...args) {
        try { push(level, args); } catch (_) {}
        return orig.apply(console, args);
    };

    const origLog = console.log.bind(console);
    const origInfo = (console.info || console.log).bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    console.log = wrap('log', origLog);
    console.info = wrap('info', origInfo);
    console.warn = wrap('warn', origWarn);
    console.error = wrap('error', origError);
}

module.exports = {
    init,
    getLast,
    getBufferSize,
    getRingMax,
    getLogsDir
};
