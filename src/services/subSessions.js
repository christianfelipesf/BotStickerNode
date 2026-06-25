const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

function dlog(msg) {
    try { process.stderr.write(`[sub] ${msg}\n`); } catch (_) {}
    try { console.log(`[sub] ${msg}`); } catch (_) {}
}

const { readConfig } = require('../database/utils');
const mediaHandler = require('../events/media');

// ============================================================
// subSessions — múltiplos sockets Baileys paralelos por usuário
// Cada owner (jid) tem sua própria sub-sessão com:
//   - credenciais persistidas em session/sub_<hash>/
//   - prefixo próprio (!setprefix <símbolo>)
//   - comandos básicos restritos: s, sticker, rv, toimg, acelerar,
//     play, tiktok (download), prefixo, menu simples
//   - em grupos ou privado (config subSessionsGroups)
//   - silencioso: erros viram reação ❌, nunca texto
// ============================================================

const SUB_SESSIONS_DIR = path.join(process.cwd(), 'session', 'subs');
const PER_SESSION_PREFIX_DEFAULT = '!';
const QR_MAX_ATTEMPTS = 3;
const QR_INTERVAL_MS = 45000;
const SUBS_GROUPS_DEFAULT = true;

const ALLOWED_BASIC = new Set([
    's', 'sticker', 'f', 'figurinha',
    'toimg', 'tovideo', 'pramidia',
    'revelar', 'r', 'rv', 'i',
    'acelerar', 'fast', 'speed',
    'desacelerar',
    'play', 'p', 'musica', 'youtube',
    'download', 'd', 'dl', 'baixar', 'media', 'social',
    'tiktok', 'ttk', 'fb', 'facebook', 'insta', 'instagram', 'reel', 'shorts',
    'prefixo', 'prefix', 'setprefix',
    'menu', 'help', 'comandos', 'tutorial'
]);

const sessions = new Map();

function hashJid(jid) {
    return crypto.createHash('sha1').update(String(jid || '')).digest('hex').slice(0, 16);
}

function sessionFolder(ownerJid) {
    const dir = path.join(SUB_SESSIONS_DIR, hashJid(ownerJid));
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return dir;
}

function getSubsGroupsEnabled() {
    try {
        const cfg = readConfig();
        if (cfg && typeof cfg.subSessionsGroups === 'boolean') return cfg.subSessionsGroups;
    } catch (_) {}
    return SUBS_GROUPS_DEFAULT;
}

function listSessions() {
    return Array.from(sessions.values()).map(s => ({
        ownerJid: s.ownerJid,
        prefix: s.prefix,
        connected: !!s.connected,
        phoneNumber: s.phoneNumber || null,
        startedAt: s.startedAt
    }));
}

function getSession(ownerJid) { return sessions.get(ownerJid) || null; }

async function reactSilent(sock, m, emoji) {
    try { await sock.sendMessage(m.key.remoteJid, { react: { text: emoji, key: m.key } }); }
    catch (_) {}
}

async function sendSilent(sock, jid, text, quoted) {
    try { await sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined); } catch (_) {}
}

async function sendImageSilent(sock, jid, buffer, caption, quoted) {
    try {
        await sock.sendMessage(jid, { image: buffer, caption }, quoted ? { quoted } : undefined);
    } catch (_) {}
}

function basicMenuText(prefix, botName) {
    return `📱 *${botName || 'Sub-sessão'} — Comandos*\n\n` +
        `╭── *MÍDIA* ──\n` +
        `│ ${prefix}s — sticker (mande imagem/vídeo)\n` +
        `│ ${prefix}rv — revelar view-once\n` +
        `│ ${prefix}toimg — sticker → imagem\n` +
        `│ ${prefix}acelerar / ${prefix}desacelerar\n` +
        `╰────────────\n\n` +
        `╭── *DOWNLOAD* ──\n` +
        `│ ${prefix}play <nome> — YouTube → mp3\n` +
        `│ ${prefix}tiktok <link> — baixa mídia\n` +
        `╰────────────\n\n` +
        `╭── *CONFIG* ──\n` +
        `│ ${prefix}prefixo — ver prefixo atual\n` +
        `│ ${prefix}setprefix <símbolo> — mudar\n` +
        `╰────────────\n\n` +
        `💡 *Sair:* ${prefix}logoff / ${prefix}sair`;
}

async function dispatchBasicCommand(session, sock, m, text) {
    const prefix = session.prefix || PER_SESSION_PREFIX_DEFAULT;
    if (!text.startsWith(prefix)) return false;
    const args = text.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const fullArgsText = args.join(' ');

    if (commandName === 'logoff' || commandName === 'sair' || commandName === 'logout') {
        await reactSilent(sock, m, '✅');
        return 'handled_internally';
    }

    if (commandName === 'prefixo' || commandName === 'prefix') {
        await sendSilent(sock, m.key.remoteJid, `⌨️ Prefixo desta sub-sessão: *${prefix}*\nPara mudar: ${prefix}setprefix <símbolo>`, m);
        await reactSilent(sock, m, '✅');
        return true;
    }

    if (commandName === 'setprefix') {
        const newPrefix = fullArgsText.trim().slice(0, 3);
        if (!newPrefix) {
            await reactSilent(sock, m, '❌');
            return true;
        }
        session.prefix = newPrefix;
        try { persistSessionMeta(session); } catch (_) {}
        await sendSilent(sock, m.key.remoteJid, `✅ Prefixo atualizado para: *${newPrefix}*`, m);
        await reactSilent(sock, m, '✅');
        return true;
    }

    if (commandName === 'menu' || commandName === 'help' || commandName === 'comandos' || commandName === 'tutorial') {
        await sendSilent(sock, m.key.remoteJid, basicMenuText(session.prefix, `Sub-sessão`), m);
        await reactSilent(sock, m, '✅');
        return true;
    }

    let allowedName = null;
    if (ALLOWED_BASIC.has(commandName)) allowedName = commandName;

    if (!allowedName) {
        await reactSilent(sock, m, '❌');
        return true;
    }

    await reactSilent(sock, m, '⏳');
    try {
        const realName = resolveRealName(commandName);
        if (!realName) { await reactSilent(sock, m, '❌'); return true; }

        const mod = require(`../commands/${realName}.js`);
        if (!mod || typeof mod.execute !== 'function') { await reactSilent(sock, m, '❌'); return true; }

        const dummyConfig = { prefix: session.prefix, botName: `Sub-sessão` };
        const utils = require('../database/utils');
        const GLOBAL_COOLDOWN = 600;
        const lastBotResponse = Date.now();

        await mod.execute(sock, m, {
            from: m.key.remoteJid,
            isGroup: !!m.key.remoteJid?.endsWith?.('@g.us'),
            sender: m.key.participant || m.key.remoteJid,
            senderName: m.pushName || 'Usuário',
            fullArgsText,
            args,
            commandName: realName,
            config: dummyConfig,
            utils,
            model: null,
            startTime: session.startedAt,
            lastBotResponse,
            GLOBAL_COOLDOWN,
            mediaHandler
        });
        await reactSilent(sock, m, '✅');
        return true;
    } catch (e) {
        console.error(`💥 [sub:${hashJid(session.ownerJid)}] erro em !${commandName}:`, e?.message || e);
        await reactSilent(sock, m, '❌');
        return true;
    }
}

function resolveRealName(name) {
    const map = {
        s: 's', sticker: 's', f: 's', figurinha: 's',
        toimg: 'toimg', tovideo: 'toimg', pramidia: 'toimg',
        revelar: 'revelar', r: 'revelar', rv: 'revelar', i: 'revelar',
        acelerar: 'acelerar', fast: 'acelerar', speed: 'acelerar',
        desacelerar: 'desacelerar',
        play: 'play', p: 'play', musica: 'play', youtube: 'play',
        download: 'download', d: 'download', dl: 'download', baixar: 'download',
        media: 'download', social: 'download',
        tiktok: 'download', ttk: 'download', fb: 'download', facebook: 'download',
        insta: 'download', instagram: 'download', reel: 'download', shorts: 'download'
    };
    return map[name] || null;
}

const META_FILE = 'sub_meta.json';
function persistSessionMeta(session) {
    try {
        const dir = sessionFolder(session.ownerJid);
        const file = path.join(dir, META_FILE);
        fs.writeFileSync(file, JSON.stringify({
            ownerJid: session.ownerJid,
            prefix: session.prefix,
            phoneNumber: session.phoneNumber || null,
            startedAt: session.startedAt
        }, null, 2));
    } catch (_) {}
}

function loadSessionMeta(ownerJid) {
    try {
        const file = path.join(sessionFolder(ownerJid), META_FILE);
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) { return null; }
}

function attachMessagesHandler(session, sock) {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type !== 'notify' && !messages?.some(msg => msg?.key?.fromMe)) return;
            for (const m of messages) {
                if (!m?.message) continue;
                if (m.key.fromMe) continue;

                const from = m.key.remoteJid;
                const isGroup = from?.endsWith('@g.us');
                if (isGroup && !getSubsGroupsEnabled()) continue;

                const text = (extractText(m.message) || '').trim();
                if (!text) continue;

                if (!text.startsWith(session.prefix)) {
                    if (text === 'prefixo' || text === 'prefix') {
                        await sendSilent(sock, from, `⌨️ Prefixo desta sub-sessão: *${session.prefix}*`, m);
                        await reactSilent(sock, m, 'ℹ️');
                    }
                    continue;
                }

                await dispatchBasicCommand(session, sock, m, text);
            }
        } catch (e) {
            console.error('💥 [sub] handler error:', e?.message || e);
        }
    });
}

function extractText(message) {
    if (!message) return '';
    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.title ||
        ''
    );
}

async function startLogin(ownerJid, { onQr, onConnected, onClosed, _silent = false, _reconnect = false }) {
    if (sessions.has(ownerJid)) {
        const existing = sessions.get(ownerJid);
        if (existing.connecting && !_silent && !_reconnect) return existing;
        if (existing.connecting) {
            try { if (existing.sock) existing.sock.end(undefined); } catch (_) {}
            sessions.delete(ownerJid);
        }
    }

    const dir = sessionFolder(ownerJid);
    const meta = loadSessionMeta(ownerJid) || {};

    const session = {
        ownerJid,
        prefix: meta.prefix || PER_SESSION_PREFIX_DEFAULT,
        phoneNumber: meta.phoneNumber || null,
        startedAt: Date.now(),
        sock: null,
        connected: false,
        connecting: true,
        qrAttempts: 0,
        qrTimer: null,
        lastQrHash: null,
        lastQrAt: 0,
        onQr, onConnected, onClosed
    };
    sessions.set(ownerJid, session);
    persistSessionMeta(session);

    try {
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        let version = [2, 3000, 1017531287];
        try {
            const latest = await fetchLatestBaileysVersion();
            if (latest?.version && Array.isArray(latest.version) && latest.version.length === 3) {
                version = latest.version;
            }
        } catch (_) {}

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'warn' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['Antigravity Bot', 'Chrome', '120.0.0.0'],
            markOnlineOnConnect: false,
            connectTimeoutMs: 60_000,
            defaultQueryTimeoutMs: 60_000,
            emitOwnEvents: true,
            syncFullHistory: false,
            retryRequestDelayMs: 2000,
            maxMsgRetryCount: 3,
            getMessage: async () => undefined
        });
        session.sock = sock;
        console.log(`🔐 [sub:${hashJid(ownerJid)}] sock criado, auth dir=${dir}, version=${JSON.stringify(version)}`);

        const cleanupAndCancel = async (reason) => {
            try { if (session.qrTimer) { clearTimeout(session.qrTimer); session.qrTimer = null; } } catch (_) {}
            try { sock.end(undefined); } catch (_) {}
            sessions.delete(ownerJid);
            console.log(`🔐 [sub:${hashJid(ownerJid)}] cleanup (${reason})`);
            await safeCallback(session.onClosed, ownerJid, reason);
        };

        const armWatchdog = () => {
            try { if (session.qrTimer) clearTimeout(session.qrTimer); } catch (_) {}
            session.qrTimer = setTimeout(async () => {
                try {
                    if (session.connected) return;
                    const sinceLast = Date.now() - (session.lastQrAt || 0);
                    if (sinceLast < QR_INTERVAL_MS) {
                        armWatchdog();
                        return;
                    }
                    await cleanupAndCancel('qr-exhausted');
                } catch (_) {}
            }, QR_INTERVAL_MS);
            if (typeof session.qrTimer.unref === 'function') session.qrTimer.unref();
        };

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (u) => {
            try {
                dlog(`${hashJid(ownerJid)} conn.update → connection=${u.connection} qr=${u.qr ? 'YES(len=' + u.qr.length + ')' : 'no'} lastDisconnect=${u.lastDisconnect?.error?.message ? u.lastDisconnect.error.message.slice(0, 80) : 'none'}`);

                if (u.qr) {
                    const qrHash = crypto.createHash('sha1').update(String(u.qr)).digest('hex');
                    const isNewQr = qrHash !== session.lastQrHash;
                    if (isNewQr) {
                        session.lastQrHash = qrHash;
                        session.lastQrAt = Date.now();
                        session.qrAttempts += 1;
                        dlog(`${hashJid(ownerJid)} novo QR → tentativa ${session.qrAttempts}/${QR_MAX_ATTEMPTS}`);
                        if (session.qrAttempts > QR_MAX_ATTEMPTS) {
                            dlog(`${hashJid(ownerJid)} limite excedido`);
                            await cleanupAndCancel('qr-exhausted');
                            return;
                        }
                        let buffer = null;
                        try { buffer = await QRCode.toBuffer(u.qr, { type: 'png', width: 512, margin: 2 }); }
                        catch (e) { dlog(`${hashJid(ownerJid)} erro PNG: ${e?.message}`); buffer = null; }
                        await safeCallback(session.onQr, ownerJid, { qr: u.qr, buffer, attempt: session.qrAttempts, max: QR_MAX_ATTEMPTS });
                    }
                    armWatchdog();
                }

                if (u.connection === 'close') {
                    session.connected = false;
                    try { if (session.qrTimer) { clearTimeout(session.qrTimer); session.qrTimer = null; } } catch (_) {}
                    const code = (u.lastDisconnect?.error instanceof Boom)
                        ? u.lastDisconnect.error.output?.statusCode
                        : u.lastDisconnect?.error?.statusCode;
                    const errMsg = u.lastDisconnect?.error?.message || 'sem mensagem';
                    dlog(`${hashJid(ownerJid)} CLOSE code=${code} msg="${errMsg}" attempts=${session.qrAttempts}`);
                    if (code === DisconnectReason.loggedOut) {
                        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
                        sessions.delete(ownerJid);
                        await safeCallback(session.onClosed, ownerJid, 'logged-out');
                    } else if (code === 515 || errMsg.toLowerCase().includes('restart required')) {
                        dlog(`${hashJid(ownerJid)} 515/restart required → recriando sock automaticamente`);
                        try { sock.end(undefined); } catch (_) {}
                        sessions.delete(ownerJid);
                        setTimeout(() => {
                            try {
                                startLogin(ownerJid, { onQr: session.onQr, onConnected: session.onConnected, onClosed: session.onClosed, _reconnect: true })
                                    .catch(e => dlog(`${hashJid(ownerJid)} erro ao recriar: ${e?.message}`));
                            } catch (_) {}
                        }, 5000);
                    } else if (code === 401) {
                        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
                        sessions.delete(ownerJid);
                        await safeCallback(session.onClosed, ownerJid, 'unauthorized');
                    } else if (session.qrAttempts >= QR_MAX_ATTEMPTS) {
                        sessions.delete(ownerJid);
                        await safeCallback(session.onClosed, ownerJid, 'qr-exhausted');
                    } else {
                        sessions.delete(ownerJid);
                        await safeCallback(session.onClosed, ownerJid, `close-${code}`);
                    }
                } else if (u.connection === 'open') {
                    session.connected = true;
                    session.connecting = false;
                    try { if (session.qrTimer) { clearTimeout(session.qrTimer); session.qrTimer = null; } } catch (_) {}
                    session.phoneNumber = sock.user?.id?.split?.(':')?.[0] || session.phoneNumber;
                    persistSessionMeta(session);
                    attachMessagesHandler(session, sock);
                    dlog(`${hashJid(ownerJid)} ✅ CONECTADO phone=${session.phoneNumber}`);
                    await safeCallback(session.onConnected, ownerJid, { phoneNumber: session.phoneNumber });
                } else if (u.connection === 'connecting') {
                    dlog(`${hashJid(ownerJid)} estado: connecting…`);
                }
            } catch (e) {
                dlog(`${hashJid(ownerJid)} conn.update ERRO: ${e?.message || e}`);
                try { dlog(`stack: ${e?.stack?.split('\n').slice(0, 4).join(' | ')}`); } catch (_) {}
            }
        });

    } catch (e) {
        console.error('💥 [sub:startLogin]', e?.message || e);
        session.connecting = false;
        sessions.delete(ownerJid);
        await safeCallback(session.onClosed, ownerJid, e?.message || 'init-failed');
    }

    return session;
}

async function safeCallback(cb, ...args) {
    if (typeof cb !== 'function') return;
    try { await cb(...args); } catch (e) { console.error('💥 [sub:cb]', e?.message || e); }
}

async function logout(ownerJid) {
    const session = sessions.get(ownerJid);
    if (!session) return false;
    try { if (session.qrTimer) clearTimeout(session.qrTimer); } catch (_) {}
    try { if (session.sock) session.sock.end(undefined); } catch (_) {}
    try { fs.rmSync(sessionFolder(ownerJid), { recursive: true, force: true }); } catch (_) {}
    sessions.delete(ownerJid);
    return true;
}

async function restoreFromDisk(onConnected) {
    try {
        if (!fs.existsSync(SUB_SESSIONS_DIR)) return [];
        const dirs = fs.readdirSync(SUB_SESSIONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
        const restored = [];
        for (const d of dirs) {
            const metaPath = path.join(SUB_SESSIONS_DIR, d.name, META_FILE);
            if (!fs.existsSync(metaPath)) continue;
            let meta;
            try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { continue; }
            if (!meta || !meta.ownerJid) continue;
            try {
                const session = await startLogin(meta.ownerJid, {
                    onQr: async () => {},
                    onConnected: async () => { if (typeof onConnected === 'function') await onConnected(meta.ownerJid); },
                    onClosed: async (jid, reason) => {
                        if (reason === 'unauthorized' || reason === 'logged-out' || reason === 'close-401' || reason === 'close-403') {
                            try {
                                const dir2 = path.join(SUB_SESSIONS_DIR, hashJid(jid));
                                fs.rmSync(dir2, { recursive: true, force: true });
                                dlog(`${hashJid(jid)} credenciais inválidas/expiradas → removidas`);
                            } catch (_) {}
                        }
                    },
                    _silent: true
                });
                restored.push(meta.ownerJid);
            } catch (e) {
                dlog(`${hashJid(meta.ownerJid)} falha ao restaurar: ${e?.message}`);
            }
        }
        return restored;
    } catch (e) {
        dlog(`restoreDisk erro: ${e?.message}`);
        return [];
    }
}

module.exports = {
    startLogin,
    logout,
    listSessions,
    getSession,
    restoreFromDisk,
    PER_SESSION_PREFIX_DEFAULT,
    QR_MAX_ATTEMPTS,
    ALLOWED_BASIC
};
