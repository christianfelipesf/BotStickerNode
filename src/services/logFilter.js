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

const _SESSION_DIAG_RE = /(Decrypted message with closed session|Closing session:|Session error:|Bad MAC)/i;
const isLibsignalNoise = (str) => {
    const s = String(str || '');
    // Sempre preservar diagnóstico de sessão para terminalLog (bypass lá), mas filtrar do console
    // Se for diag, considerar noise para logger.js wrapStream mas permitir bypass em terminalLog via _SESSION_DIAG_RE check
    return _LIB_PATTERNS.some(re => re.test(s));
};
const isSessionDiag = (str) => _SESSION_DIAG_RE.test(String(str||''));

function pad(n) { return String(n).padStart(2, '0'); }

function ts(d = new Date()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function tsLabel(d = new Date()) { return ts(d); }

function fileLabel(d = new Date()) { return d.toISOString().slice(0, 10); }

module.exports = { _LIB_PATTERNS, isLibsignalNoise, isSessionDiag, pad, ts, tsLabel, fileLabel };
