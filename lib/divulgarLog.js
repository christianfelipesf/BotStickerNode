const fs = require('fs');
const path = require('path');

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    try { fs.mkdirSync(logsDir, { recursive: true }); } catch (_) {}
}

function ts() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function getSessionLogFile() {
    return path.join(logsDir, `divulgar_${new Date().toISOString().slice(0, 10)}.log`);
}

function logToFile(line) {
    const lineWithTs = `[${ts()}] ${line}\n`;
    try { fs.appendFileSync(getSessionLogFile(), lineWithTs); } catch (_) {}
    return lineWithTs.trimEnd();
}

function info(line) { return logToFile(`[INFO ] ${line}`); }
function ok(line)   { return logToFile(`[ OK  ] ${line}`); }
function warn(line) { return logToFile(`[WARN ] ${line}`); }
function err(line)  { return logToFile(`[FAIL ] ${line}`); }
function head(line) { return logToFile(`====== ${line} ======`); }

module.exports = { info, ok, warn, err, head, ts, getSessionLogFile };
