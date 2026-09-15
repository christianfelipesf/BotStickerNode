const { default: PQueue } = require('p-queue');

// timeout 30s evita fila travada, mas download precisa >30s (yt-dlp sem cookies leva 22-35s) — sem isso todo !play cai no fallback e estoura CMD_TIMEOUT 45s
const downloadQueue = new PQueue({ concurrency: 2, interval: 1000, intervalCap: 3, timeout: 120000, throwOnTimeout: true });
const sendQueue = new PQueue({ concurrency: 1, interval: 1500, intervalCap: 2, timeout: 30000, throwOnTimeout: true });
const processQueue = new PQueue({ concurrency: 3, interval: 500, intervalCap: 5, timeout: 30000, throwOnTimeout: true });

for (const q of [downloadQueue, sendQueue, processQueue]) {
    // Só loga: a rejeição é tratada pelo chamador via retry abaixo.
    // Sem isso, timeout virava unhandledRejection → process.exit(1).
    q.on('error', (err) => console.warn(`⚠️ [queue] timeout/error: ${err?.message?.slice(0,120)||err}`));
}

// 1 retry automático em timeout/falha transitória: evita que um soluço
// (upload lento, yt-dlp congestionado) mate o comando de primeira.
async function withRetry(fn, label) {
    try {
        return await fn();
    } catch (e) {
        const transient = /timeout|timed out|econnreset|socket|temporar|429|rate/i.test(String(e?.message || e));
        if (!transient) throw e;
        console.warn(`⚠️ [queue] retry ${label}: ${String(e?.message || e).slice(0, 100)}`);
        await new Promise(r => setTimeout(r, 2000));
        return await fn();
    }
}

function enqueueDownload(fn) {
    return downloadQueue.add(() => withRetry(fn, 'download'));
}

function enqueueSend(fn) {
    return sendQueue.add(() => withRetry(fn, 'send'));
}

function enqueueProcess(fn) {
    return processQueue.add(() => withRetry(fn, 'process'));
}

function queueSize() {
    return {
        download: downloadQueue.size,
        send: sendQueue.size,
        process: processQueue.size,
        pending: downloadQueue.pending + sendQueue.pending + processQueue.pending
    };
}

module.exports = {
    enqueueDownload,
    enqueueSend,
    enqueueProcess,
    queueSize
};
