const { getGroupLink, getAdmins, normalizeJid } = require('../utils');
const { info, ok, err, head, warn } = require('../lib/divulgarLog');

const DELAY_MIN = 45000;
const DELAY_MAX = 90000;
const JITTER_MAX = 15000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

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
    const admins = adminsRaw.map(normalizeJid);
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
    info(`Tempo estimado: ~${Math.ceil(targets.length * 75 / 60)} min`);

    const reactResult = await react(sock, m, '📣', lastBotResponse, GLOBAL_COOLDOWN);

    try { await sock.sendMessage(from, { delete: m.key }); } catch (_) {}

    let success = 0;
    let failed = 0;
    const failures = [];

    for (let i = 0; i < targets.length; i++) {
        const jid = targets[i];
        const num = jid.split('@')[0];
        const template = pickTemplate();
        const text = template(num, link);

        const delay = rand(DELAY_MIN, DELAY_MAX) + rand(0, JITTER_MAX);
        info(`[${i + 1}/${targets.length}] Aguardando ${(delay / 1000).toFixed(1)}s antes de enviar para ${num}`);
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
            success++;
            ok(`Enviado para ${num}`);
        } catch (e) {
            failed++;
            failures.push({ jid, error: e?.message || String(e) });
            err(`Falha ao enviar para ${num}: ${e?.message || e}`);
        }

        if ((i + 1) % 10 === 0) {
            info(`Progresso: ${i + 1}/${targets.length} | sucessos=${success} | falhas=${failed}`);
        }
    }

    head(`Divulgação finalizada em ${metadata.subject}`);
    info(`Sucessos: ${success}`);
    info(`Falhas: ${failed}`);
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
        const react = (utils && utils.react) ? utils.react : require('../utils').react;

        if (!isGroup) {
            return sock.sendMessage(from, { text: '❌ Use este comando dentro do grupo que você quer divulgar.' }, { quoted: m });
        }

        return runDivulgacao(sock, m, { from, sender, lastBotResponse, GLOBAL_COOLDOWN, react });
    }
};
