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

const wrapStream = (streamName) => {
    const stream = process[streamName];
    if (!stream || !stream.write) return;
    const originalWrite = stream.write.bind(stream);
    stream.write = function (chunk, encoding, cb) {
        try {
            const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
            if (_isLibsignalNoise(text)) {
                if (typeof cb === 'function') cb();
                return true;
            }
        } catch (_) {}
        return originalWrite(chunk, encoding, cb);
    };
    return stream;
};

module.exports = {
    initLogger: () => {
        wrapStream('stdout');
        wrapStream('stderr');
    }
};
