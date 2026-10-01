const EV = require('events');

const emitter = new EV();
let _connected = false;
let _version = null;
let _phone = null;
let _connectedAt = null;
let _sock = null;
let _qr = null;

function setQr(qr) { _qr = qr || null; }
function clearQr() { _qr = null; }

function setSock(sock) { _sock = sock || null; }
function getSock() { return _sock; }
function clearSock() { _sock = null; }

function setConnected(meta = {}) {
    const wasConnected = _connected;
    _connected = true;
    _version = meta.version || _version;
    _phone = meta.phone || _phone;
    _connectedAt = _connectedAt || new Date();
    _qr = null;
    if (!wasConnected) emitter.emit('connected', getState());
}

function setDisconnected() {
    _connected = false;
    emitter.emit('disconnected');
}

function getState() {
    return {
        connected: _connected,
        status: _connected ? 'connected' : 'disconnected',
        version: _version,
        phone: _phone,
        qr: _qr,
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

function isConnected() { return _connected; }

function getVersion() { return _version; }

module.exports = {
    setConnected,
    setDisconnected,
    setQr,
    clearQr,
    getState,
    waitForConnection,
    isConnected,
    getVersion,
    setSock,
    getSock,
    clearSock,
    emitter
};
