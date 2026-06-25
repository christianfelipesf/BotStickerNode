const { getGroupLink, getAdmins, normalizeJid } = require('../database/utils');
const { info, ok, err, head, warn } = require('../services/divulgarLog');

const DELAY_MIN = 45000;
const DELAY_MAX = 90000;
const JITTER_MAX = 15000;
const CONFIRM_TIMEOUT = 2 * 60 * 1000;

const pendingConfirmations = new Map();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

function pad(n) { return String(n).padStart(2, '0'); }
function formatMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const ss = s % 60;
    if (m < 60) return `${m}m${ss}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h${pad(mm)}m${pad(ss)}s`;
}
function formatElapsed(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h${pad(m)}m${pad(s)}s`;
    if (m > 0) return `${m}m${pad(s)}s`;
    return `${s}s`;
}

const TEMPLATES = [
    (name, link) => `Fala ${name}, tudo bem? 😊
Vi você no grupo e queria te chamar pra esse aqui também, a galera é bem de boa: ${link}`,
    (name, link) => `E aí ${name}! 👋
Passando pra te convidar pra um grupo que tô participando, tá muito bom: ${link}
Se rolar, entra lá!`,
    (name, link) => `Oi ${name}! Tudo certo?
Me add lá nesse grupo também, vai gostar: ${link}`,
    (name, link) => `${name}, salve! 🙌
Tô num grupo maneiro e lembrei de ti, dá uma olhada: ${link}
Qualquer coisa é só chamar!`,
];

function pickTemplate() {
    return TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
}

async function sendConfirmation(sock, m, from, sender, targets, metadata) {
    const link = getGroupLink();
    const totalMs = targets.length * 75 * 1000;
    const key = `${sender}:${from}`;

    const msg = await sock.sendMessage(from, {
        text: `⚠️ *CONFIRMAÇÃO NECESSÁRIA*\n\n` +
            `📢 Enviar link do grupo *${metadata.subject}* para *${targets.length} membro(s)* via DM.\n` +
            `⏱️ Tempo estimado: ~${Math.ceil(targets.length * 75 / 60)} min\n` +
            `🔗 Link: ${link}\n\n` +
            `❗ Isso pode ser considerado *spam* e resultar em *ban* da sua conta do WhatsApp.\n\n` +
            `Para confirmar, use o comando novamente:\n` +
            `\`!divulgar confirmar\`\n\n` +
            `_Expira em 2 minutos._`
    }, { quoted: m });

    pendingConfirmations.set(key, { targets, metadata, msg, timeout: Date.now() + CONFIRM_TIMEOUT });
    setTimeout(() => {
        if (pendingConfirmations.get(key)?.msg?.key?.id === msg.key.id) {
            pendingConfirmations.delete(key);
        }
    }, CONFIRM_TIMEOUT);
}

async function runDivulgacao(sock, m, ctx) {
    const { from, sender, lastBotResponse, GLOBAL_COOLDOWN, react } = ctx;

    const link = getGroupLink();
    if (!link) return sock.sendMessage(from, { text: '❌ Nenhum link configurado. Use !setlink <link> primeiro.' }, { quoted: m });

    const meId = normalizeJid(sock.user.id);
    const senderNorm = normalizeJid(sender);
    const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

    info(`[divulgar] sender=${sender} | senderNorm=${senderNorm} | fromMe=${m.key.fromMe} | meId=${meId} | isBotOwner=${isBotOwner}`);

    if (!isBotOwner) {
        return sock.sendMessage(from, { text: '❌ Apenas quem está conectado no bot (celular que escaneou o QR) pode usar este comando.' }, { quoted: m });
    }

    const adminsRaw = await getAdmins(sock, from);
    const admins = adminsRaw.map(p => normalizeJid(p.id || p.jid));
    info(`[divulgar] admins (${admins.length}): ${admins.join(', ')}`);

    let metadata;
    try {
        metadata = await sock.groupMetadata(from);
    } catch (e) {
        return sock.sendMessage(from, { text: '❌ Não consegui ler os membros do grupo.' }, { quoted: m });
    }

    const targets = metadata.participants
        .map(p => p.id)
        .filter(id => {
            if (!id) return false;
            const norm = normalizeJid(id);
            return norm !== meId && !admins.includes(norm);
        });

    if (targets.length === 0) {
        warn(`Divulgar cancelado: grupo ${metadata.subject} (${from}) só tem admins/bot. Nenhum alvo.`);
        try { await sock.sendMessage(from, { react: { text: '🚫', key: m.key } }); } catch (_) {}
        return sock.sendMessage(from, {
            text: `🚫 Nada pra divulgar. O grupo *${metadata.subject}* só tem admins (e o bot), não há membros comuns.`
        }, { quoted: m });
    }

    head(`Divulgação iniciada em ${metadata.subject} (${from})`);
    info(`Total de alvos (sem bots/admins): ${targets.length}`);
    const totalMs = targets.length * 75 * 1000;
    info(`Tempo estimado: ~${Math.ceil(targets.length * 75 / 60)} min (${formatMs(totalMs)})`);

    const reactResult = await react(sock, m, '📣', lastBotResponse, GLOBAL_COOLDOWN);

    try { await sock.sendMessage(from, { delete: m.key }); } catch (_) {}

    const startTs = Date.now();
    let success = 0;
    let failed = 0;
    let totalDelay = 0;
    const failures = [];
    let lastProgressLog = 0;

    for (let i = 0; i < targets.length; i++) {
        const jid = targets[i];
        const num = jid.split('@')[0];
        const template = pickTemplate();
        const text = template(num, link);

        const delay = rand(DELAY_MIN, DELAY_MAX) + rand(0, JITTER_MAX);
        totalDelay += delay;
        const sendStart = Date.now();
        info(`[${i + 1}/${targets.length}] → ${num} | aguardando ${(delay / 1000).toFixed(1)}s | elapsed=${formatElapsed(Date.now() - startTs)}`);
        await sleep(delay);

        try {
            await sock.sendMessage(jid, {
                text,
                linkPreview: {
                    head: link,
                    body: text.split('\n')[0],
                    matchedText: link,
                    title: metadata.subject,
                    description: '',
                    canonicalUrl: link,
                    url: link
                }
            });
            const took = Date.now() - sendStart - delay;
            success++;
            ok(`[${i + 1}/${targets.length}] ✓ ${num} (envio ${took}ms)`);
        } catch (e) {
            failed++;
            failures.push({ jid, error: e?.message || String(e) });
            err(`[${i + 1}/${targets.length}] ✗ ${num}: ${e?.message || e}`);
        }

        const done = i + 1;
        const now = Date.now();
        const remaining = targets.length - done;
        const avgDelay = totalDelay / done;
        const etaMs = remaining * avgDelay;
        const etaDate = new Date(now + etaMs);
        const etaStr = etaDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        if (now - lastProgressLog >= 15000 || done === targets.length) {
            lastProgressLog = now;
            const pct = ((done / targets.length) * 100).toFixed(1);
            info(`📊 progresso ${done}/${targets.length} (${pct}%) | ✓${success} ✗${failed} | elapsed=${formatElapsed(now - startTs)} | ETA=${etaStr} (~${formatMs(etaMs)})`);
        }
    }

    const totalElapsed = Date.now() - startTs;
    head(`Divulgação finalizada em ${metadata.subject}`);
    info(`⏱️  Tempo total: ${formatElapsed(totalElapsed)}`);
    info(`✓ Sucessos: ${success}`);
    info(`✗ Falhas: ${failed}`);
    if (failures.length > 0) {
        info('IDs que falharam:');
        for (const f of failures.slice(0, 50)) {
            info(`  - ${f.jid} -> ${f.error}`);
        }
        if (failures.length > 50) info(`  ... e mais ${failures.length - 50}`);
    }

    try {
        await sock.sendMessage(from, { react: { text: failed === 0 ? '✅' : '⚠️', key: m.key } });
    } catch (_) {}

    return reactResult;
}

module.exports = {
    name: 'divulgar',
    aliases: ['divulga', 'convida', 'convitar'],
    category: 'utilidades',
    description: 'Envia o link do grupo (config.linkgrupo) por DM para os membros, de forma orgânica e devagar',
    async execute(sock, m, ctx) {
        const { from, isGroup, sender, lastBotResponse, GLOBAL_COOLDOWN, utils } = ctx;
        const react = (utils && utils.react) ? utils.react : require('../database/utils').react;

        if (!isGroup) {
            return sock.sendMessage(from, { text: '❌ Use este comando dentro do grupo que você quer divulgar.' }, { quoted: m });
        }

        const key = `${sender}:${from}`;
        const pending = pendingConfirmations.get(key);

        const isConfirm = ctx.fullArgsText?.trim()?.toLowerCase() === 'confirmar'
            || ctx.args?.[0]?.toLowerCase() === 'confirmar';

        if (isConfirm && pending) {
            pendingConfirmations.delete(key);
            return runDivulgacao(sock, m, { from, sender, lastBotResponse, GLOBAL_COOLDOWN, react });
        }

        if (pending) {
            const remaining = Math.ceil((pending.timeout - Date.now()) / 1000);
            return sock.sendMessage(from, {
                text: `⏳ Divulgação já aguardando confirmação para este grupo.\n` +
                    `Use \`!divulgar confirmar\` para confirmar.\n` +
                    `_Expira em ${remaining}s_`
            }, { quoted: m });
        }

        const link = getGroupLink();
        if (!link) return sock.sendMessage(from, { text: '❌ Nenhum link configurado. Use !setlink <link> primeiro.' }, { quoted: m });

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

        if (!isBotOwner) {
            return sock.sendMessage(from, { text: '❌ Apenas quem está conectado no bot (celular que escaneou o QR) pode usar este comando.' }, { quoted: m });
        }

        const adminsRaw = await getAdmins(sock, from);
        const admins = adminsRaw.map(p => normalizeJid(p.id || p.jid));

        let metadata;
        try {
            metadata = await sock.groupMetadata(from);
        } catch (e) {
            return sock.sendMessage(from, { text: '❌ Não consegui ler os membros do grupo.' }, { quoted: m });
        }

        const targets = metadata.participants
            .map(p => p.id)
            .filter(id => {
                if (!id) return false;
                const norm = normalizeJid(id);
                return norm !== meId && !admins.includes(norm);
            });

        if (targets.length === 0) {
            warn(`Divulgar cancelado: grupo ${metadata.subject} (${from}) só tem admins/bot. Nenhum alvo.`);
            try { await sock.sendMessage(from, { react: { text: '🚫', key: m.key } }); } catch (_) {}
            return sock.sendMessage(from, {
                text: `🚫 Nada pra divulgar. O grupo *${metadata.subject}* só tem admins (e o bot), não há membros comuns.`
            }, { quoted: m });
        }

        return sendConfirmation(sock, m, from, sender, targets, metadata);
    }
};
