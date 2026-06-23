function ts() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function patch() {
    const wrap = (orig) => function (...args) {
        const prefix = `[${ts()}]`;
        if (args.length === 0) return orig(prefix);
        const first = args[0];
        if (typeof first === 'string') return orig(prefix + ' ' + first, ...args.slice(1));
        return orig(prefix, ...args);
    };
    const origLog = console.log.bind(console);
    const origInfo = console.info?.bind(console);
    const origWarn = console.warn?.bind(console);
    const origError = console.error.bind(console);
    console.log = wrap(origLog);
    if (origInfo) console.info = wrap(origInfo);
    if (origWarn) console.warn = wrap(origWarn);
    console.error = wrap(origError);
}

module.exports = { ts, patch };