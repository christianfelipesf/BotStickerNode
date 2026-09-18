/**
 * Util central de timeout com AbortController.
 * Mantém compatibilidade: callers antigos que usavam Promise.race manual
 * migram para cá sem mudar assinatura externa.
 */

class TimeoutError extends Error {
    constructor(message, timeoutMs) {
        super(message);
        this.name = 'TimeoutError';
        this.timeoutMs = timeoutMs;
        this.code = 'ETIMEDOUT';
    }
}

/**
 * Executa promise com timeout. Não tenta "cancelar" a promise perdedora
 * (JS não permite), mas garante: timer sempre limpo, erro tipado e
 * hook onTimeout (ex: abortController.abort(), marcar cancelToken).
 *
 * @param {Promise} promise promise original (já criada)
 * @param {number} ms timeout em ms
 * @param {string} label rótulo p/ mensagem de erro
 * @param {object} opts { signal?, onTimeout? }
 */
function withTimeout(promise, ms, label = 'operação', opts = {}) {
    let timer = null;
    const { signal, onTimeout } = opts;

    if (signal?.aborted) {
        return Promise.reject(new TimeoutError(`${label} abortado antes de iniciar`, 0));
    }

    // Evita unhandledRejection da perdedora: anexa handler que só loga.
    // O resultado original continua fluindo para o race.
    promise.catch((e) => {
        if (process.env.DEBUG_TIMEOUT) {
            console.warn(`⚠️ [timeout] ${label} rejeitou após race: ${String(e?.message || e).slice(0, 120)}`);
        }
    });

    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            try { if (typeof onTimeout === 'function') onTimeout(); } catch (_) {}
            reject(new TimeoutError(`${label} excedeu timeout de ${ms}ms`, ms));
        }, ms);
        if (timer.unref) timer.unref();
    });

    if (signal) {
        const onAbort = () => {
            clearTimeout(timer);
            try { if (typeof onTimeout === 'function') onTimeout(); } catch (_) {}
        };
        if (typeof signal.addEventListener === 'function') {
            signal.addEventListener('abort', onAbort, { once: true });
        }
    }

    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        timeoutPromise,
    ]);
}

/**
 * Cria um cancelToken cooperativo + AbortController pareados.
 * Comandos cooperativos (divulgar/transmitir) checam cancelToken.cancelled;
 * comandos com child_process/ffmpeg devem ouvir abortSignal.
 */
function createCancelScope() {
    const cancelToken = { cancelled: false };
    const abortController = new AbortController();
    const cancel = (reason) => {
        cancelToken.cancelled = true;
        cancelToken.reason = reason || 'timeout';
        try { abortController.abort(); } catch (_) {}
    };
    return { cancelToken, abortController, cancel };
}

module.exports = { withTimeout, TimeoutError, createCancelScope };
