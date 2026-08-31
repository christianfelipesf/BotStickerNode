const { isLibsignalNoise: _isLibsignalNoise } = require('./logFilter');

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
