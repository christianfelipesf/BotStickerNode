/**
 * Watchdog anti-zumbi — detecta bot "conectado" mas sem receber mensagens
 * ou com websocket half-open, e força reconexão + alerta Telegram.
 */
const { queueSize } = require('./queue');

let _sockGetter = null;
let _configGetter = null;
let _onZombie = null;
let _onHealthy = null;

let lastUpsertAt = Date.now();
let lastConnectionAt = Date.now();
let connectedAt = null;
let checkTimer = null;
let zombieCount = 0;
let wasZombie = false;
let lastWsState = null;

// defaults — sobrescritos por config DB
const DEFAULTS = {
    enabled: true,
    idleThresholdMs: 5 * 60 * 1000,      // 5 min sem upsert => zumbi
    checkIntervalMs: 60 * 1000,           // checa a cada 60s
    wsCheckEnabled: true,
    queueStallMs: 5 * 60 * 1000,
    autoReconnect: true,
    maxZombieBeforeExit: 3               // após 3 detecções consecutivas, exit(1) p/ Docker reiniciar
};

function touchInbound() {
    lastUpsertAt = Date.now();
    if (wasZombie) {
        wasZombie = false;
        zombieCount = 0;
        if (_onHealthy) try { _onHealthy({ idleMs: 0 }); } catch (_) {}
    }
}

function touchConnection() {
    lastConnectionAt = Date.now();
    connectedAt = Date.now();
    // reset idle também na conexão
    lastUpsertAt = Date.now();
    wasZombie = false;
    zombieCount = 0;
}

function getState() {
    const now = Date.now();
    const idleMs = now - lastUpsertAt;
    const connIdleMs = now - lastConnectionAt;
    let wsState = null;
    let wsReadyState = null;
    try {
        const sock = _sockGetter ? _sockGetter() : null;
        wsReadyState = sock?.ws?.readyState ?? sock?.ws?.socket?._readyState ?? null;
        // WebSocket.OPEN = 1
        if (wsReadyState === 1) wsState = 'OPEN';
        else if (wsReadyState === 0) wsState = 'CONNECTING';
        else if (wsReadyState === 2) wsState = 'CLOSING';
        else if (wsReadyState === 3) wsState = 'CLOSED';
        else if (sock) wsState = 'UNKNOWN';
        else wsState = 'NO_SOCK';
        lastWsState = wsState;
    } catch (_) { wsState = 'ERROR'; }

    let queue = null;
    try { queue = queueSize(); } catch (_) {}

    const cfg = _getConfig();
    const threshold = cfg.idleThresholdMs;
    const isStale = idleMs > threshold;
    const wsHealthy = wsReadyState === 1 || wsReadyState == null; // null = sem sock ainda
    const queueStalled = queue && queue.pending > 0 && idleMs > cfg.queueStallMs;

    // Só considera zumbi se estiver "conectado" há mais que threshold
    const connectedDuration = connectedAt ? (now - connectedAt) : 0;
    const shouldCheck = connectedAt && connectedDuration > threshold;

    const isZombie = shouldCheck && (isStale || (!wsHealthy && cfg.wsCheckEnabled) || queueStalled);

    return {
        lastUpsertAt,
        lastConnectionAt,
        connectedAt,
        idleMs,
        connIdleMs,
        connectedDuration,
        wsState,
        wsReadyState,
        queue,
        threshold,
        isStale,
        isZombie,
        zombieCount,
        wasZombie
    };
}

function _getConfig() {
    let cfg = DEFAULTS;
    try {
        if (_configGetter) cfg = { ...DEFAULTS, ..._configGetter() };
        else {
            const { readConfig } = require('../database/utils');
            const db = readConfig();
            cfg = {
                ...DEFAULTS,
                idleThresholdMs: Number(db.watchdogIdleMinutes || 5) * 60 * 1000,
                enabled: db.watchdogEnabled !== false,
                autoReconnect: db.watchdogAutoReconnect !== false
            };
        }
    } catch (_) {}
    return cfg;
}

function start(opts = {}) {
    _sockGetter = opts.getSock || _sockGetter;
    _configGetter = opts.getConfig || _configGetter;
    _onZombie = opts.onZombie || _onZombie;
    _onHealthy = opts.onHealthy || _onHealthy;

    if (checkTimer) clearInterval(checkTimer);

    const interval = (opts.checkIntervalMs || _getConfig().checkIntervalMs);
    checkTimer = setInterval(() => _check(), interval);
    if (checkTimer.unref) checkTimer.unref();

    console.log(`👁️ [watchdog] iniciado — threshold=${Math.round(_getConfig().idleThresholdMs/60000)}min intervalo=${Math.round(interval/1000)}s`);
    return checkTimer;
}

function stop() {
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = null;
}

async function _check() {
    const cfg = _getConfig();
    if (!cfg.enabled) return;

    const state = getState();
    if (!state.isZombie) {
        // Se estava zumbi e voltou, já foi tratado em touchInbound
        return;
    }

    zombieCount++;
    wasZombie = true;

    const reasonParts = [];
    if (state.isStale) reasonParts.push(`sem mensagens há ${Math.round(state.idleMs/60000)}min`);
    if (state.wsState !== 'OPEN') reasonParts.push(`ws=${state.wsState}`);
    if (state.queue && state.queue.pending > 0) reasonParts.push(`fila travada pending=${state.queue.pending}`);
    const reason = reasonParts.join(' • ') || 'inatividade';

    console.warn(`🚨 [watchdog] ZUMBI detectado (#${zombieCount}) — ${reason} | idle=${Math.round(state.idleMs/1000)}s ws=${state.wsState}`);

    // Tenta alertar via callback (telegram)
    if (_onZombie) {
        try { await _onZombie({ ...state, reason, count: zombieCount }); } catch (e) { console.warn('[watchdog] onZombie falhou:', e.message); }
    }

    if (!cfg.autoReconnect) {
        console.warn('⏸️ [watchdog] autoReconnect desativado — apenas alerta');
        return;
    }

    // Tentativa de recuperação: força ws close para disparar connection.update:close
    try {
        const sock = _sockGetter ? _sockGetter() : null;
        if (sock) {
            // 1) tenta fechar ws
            try {
                if (sock.ws && typeof sock.ws.close === 'function') {
                    console.log('🔧 [watchdog] forçando ws.close()');
                    sock.ws.close();
                } else if (sock.ws?.socket?.close) {
                    sock.ws.socket.close();
                }
            } catch (e) { console.warn('[watchdog] ws.close falhou:', e.message); }

            // 2) tenta end()
            try { if (typeof sock.end === 'function') sock.end(new Error('watchdog zombie recovery')); } catch (_) {}
        }
    } catch (e) { console.warn('[watchdog] recovery falhou:', e.message); }

    // Se persistir por N ciclos, força exit para Docker reiniciar
    if (zombieCount >= cfg.maxZombieBeforeExit) {
        console.error(`💀 [watchdog] zumbi persistente (${zombieCount}/${cfg.maxZombieBeforeExit}) — forçando process.exit(1) para Docker reiniciar`);
        try {
            const { flushNow } = require('../database/utils');
            flushNow();
        } catch (_) {}
        setTimeout(() => process.exit(1), 1500).unref();
    }
}

module.exports = {
    start,
    stop,
    touchInbound,
    touchConnection,
    getState,
    // para testes
    _check,
    _getConfig
};
