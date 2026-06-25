const cooldowns = new Map();

const COOLDOWN_CLEANUP_INTERVAL = 5 * 60 * 1000;
const COOLDOWN_MAX_AGE = 60 * 1000;

const CMD_COOLDOWN_DEFAULTS = {
    default: 2000,
    s: 3000,
    sticker: 3000,
    f: 3000,
    figurinha: 3000,
    toimg: 3000,
    acelerar: 3000,
    desacelerar: 3000,
    revelar: 2000,
    rv: 2000,
    i: 2000,
    ai: 3000,
    resumir: 10000,
    tts: 5000,
    play: 5000,
    dl: 5000,
    d: 5000,
    download: 5000,
    dhd: 5000,
    downloadhd: 5000,
    menu: 1000,
    help: 1000,
    comandos: 1000,
    status: 2000,
    ping: 2000,
    info: 2000,
    divulgar: 60000,
    mencionar: 30000,
    set: 3000,
    config: 3000,
    news: 5000,
    perfil: 3000,
    dashboard: 2000,
    dash: 2000,
    painel: 2000,
    dump: 10000,
    grupos: 5000,
    log: 5000,
    limpar: 5000,
    ban: 3000,
    mute: 3000,
    desmute: 3000,
    antilink: 3000,
    adv: 3000
};

function getKey(commandName, userId) {
    return `${commandName}:${userId}`;
}

function getEffectiveCooldownMs(commandName) {
    return CMD_COOLDOWN_DEFAULTS[commandName] ?? CMD_COOLDOWN_DEFAULTS.default;
}

function checkCooldown(commandName, userId) {
    if (!commandName || !userId) return 0;
    const key = getKey(commandName, userId);
    const lastTime = cooldowns.get(key);
    const now = Date.now();
    const cooldownMs = getEffectiveCooldownMs(commandName);

    if (cooldownMs <= 0) return 0;

    if (lastTime && (now - lastTime) < cooldownMs) {
        return lastTime + cooldownMs - now;
    }

    cooldowns.set(key, now);
    return 0;
}

function getRemainingSeconds(commandName, userId) {
    const remaining = checkCooldown(commandName, userId);
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / 1000);
}

function clearCooldown(commandName, userId) {
    const key = getKey(commandName, userId);
    cooldowns.delete(key);
}

function clearAllCooldowns() {
    cooldowns.clear();
}

setInterval(() => {
    const now = Date.now();
    for (const [key, time] of cooldowns) {
        if (now - time > COOLDOWN_MAX_AGE) {
            cooldowns.delete(key);
        }
    }
}, COOLDOWN_CLEANUP_INTERVAL).unref();

module.exports = {
    checkCooldown,
    getRemainingSeconds,
    clearCooldown,
    clearAllCooldowns,
    getEffectiveCooldownMs,
    CMD_COOLDOWN_DEFAULTS
};
