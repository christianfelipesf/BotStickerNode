const EV = require('events');

const emitter = new EV();
let _connected = false;
let _version = null;
let _phone = null;
let _connectedAt = null;

function setConnected(meta = {}) {
    const wasConnected = _connected;
    _connected = true;
    _version = meta.version || _version;
    _phone = meta.phone || _phone;
    _connectedAt = _connectedAt || new Date();
    if (!wasConnected) emitter.emit('connected', getState());
}

function setDisconnected() {
    _connected = false;
    emitter.emit('disconnected');
}

function getState() {
    return {
        connected: _connected,
        version: _version,
        phone: _phone,
        connectedAt: _connectedAt
    };
}

function waitForConnection(timeoutMs = 60000) {
    if (_connected) return Promise.resolve(getState());
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            emitter.off('connected', onConn);
            reject(new Error('timeout esperando bot principal conectar'));
        }, timeoutMs);
        const onConn = (state) => {
            clearTimeout(t);
            resolve(state);
        };
        emitter.once('connected', onConn);
    });
}

module.exports = {
    setConnected,
    setDisconnected,
    getState,
    waitForConnection,
    emitter
};
