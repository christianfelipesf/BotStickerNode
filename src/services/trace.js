const _start = Date.now();

function _now() {
    return new Date().toLocaleString('pt-BR', { hour12: false });
}

function _ms() {
    return String(Date.now() - _start).padStart(6, ' ');
}

function fmt(label, detail) {
    const detailPart = detail ? ` — ${detail}` : '';
    return `[${_now()}] [+${_ms()}ms] ${label}${detailPart}`;
}

const counters = {};
function step(scope, label, detail) {
    counters[scope] = (counters[scope] || 0) + 1;
    const n = String(counters[scope]).padStart(3, '0');
    const detailPart = detail ? ` — ${detail}` : '';
    return `[${_now()}] [+${_ms()}ms] ${scope} #${n} ${label}${detailPart}`;
}

function section(title) {
    const bar = '─'.repeat(Math.max(0, 60 - title.length - 4));
    return `\n──── ${title} ${bar}`;
}

function event(scope, eventName, detail) {
    const detailPart = detail ? ` — ${detail}` : '';
    return `[${_now()}] [+${_ms()}ms] ${scope} ◆ ${eventName}${detailPart}`;
}

module.exports = { fmt, step, section, event, _start };