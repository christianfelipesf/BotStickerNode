const { default: PQueue } = require('p-queue');

// timeout 30s evita fila travada para sempre (zumbi de mídia)
const downloadQueue = new PQueue({ concurrency: 2, interval: 1000, intervalCap: 3, timeout: 30000, throwOnTimeout: true });
const sendQueue = new PQueue({ concurrency: 1, interval: 1500, intervalCap: 2, timeout: 30000, throwOnTimeout: true });
const processQueue = new PQueue({ concurrency: 3, interval: 500, intervalCap: 5, timeout: 30000, throwOnTimeout: true });

for (const q of [downloadQueue, sendQueue, processQueue]) {
    q.on('error', (err) => console.warn(`⚠️ [queue] timeout/error: ${err?.message?.slice(0,120)||err}`));
}

function enqueueDownload(fn) {
    return downloadQueue.add(fn);
}

function enqueueSend(fn) {
    return sendQueue.add(fn);
}

function enqueueProcess(fn) {
    return processQueue.add(fn);
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
