const utils = require('../database/utils');

function normalizeJidSafe(jid) {
    try { return utils.normalizeJid(jid); } catch (_) { return jid; }
}

function isBotOwner(sock, m, sender) {
    const meId = normalizeJidSafe(sock?.user?.id);
    const senderNorm = normalizeJidSafe(sender);
    return m?.key?.fromMe === true || sender === meId || senderNorm === meId;
}

async function requireOwner(sock, m, sender, from) {
    if (isBotOwner(sock, m, sender)) return { ok: true };
    if (utils.canAdminControl()) {
        try {
            const admins = await utils.getAdmins(sock, from);
            if (utils.isUserAdmin(sender, admins)) return { ok: true };
        } catch (_) {}
    }
    return { ok: false };
}

async function requireAdmin(sock, from, sender) {
    try {
        const admins = await utils.getAdmins(sock, from);
        const isAdmin = utils.isUserAdmin(sender, admins);
        if (!isAdmin) return { ok: false, admins };
        return { ok: true, admins };
    } catch (_) {
        return { ok: false, admins: [] };
    }
}

async function requireBotAdmin(sock, from) {
    try { return await utils.botIsAdmin(sock, from); } catch (_) { return false; }
}

function getTargetText(args, m, utilsRef) {
    let text = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();
    if (!text) {
        const quoted = m?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (quoted && utilsRef?.getMessageText) text = utilsRef.getMessageText(quoted).trim();
    }
    if (!text && utilsRef?.getMessageText) {
        try { const t = utilsRef.getMessageText(m.message).trim(); if (t && !t.startsWith('!') && !t.startsWith('/')) text = t; } catch (_) {}
    }
    return text;
}

module.exports = { isBotOwner, requireOwner, requireAdmin, requireBotAdmin, getTargetText };
