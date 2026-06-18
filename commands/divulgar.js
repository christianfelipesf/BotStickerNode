const { getGroupLink, getAdmins } = require('../utils');
const { info, ok, err, head } = require('../lib/divulgarLog');

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

async function buildPreview(sock, from, sender) {
    const link = getGroupLink();
    if (!link) return { error: '❌ Nenhum link configurado. Use !setlink <link> primeiro.' };

    const meId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const admins = await getAdmins(sock, from);
    if (!admins.includes(sender) && sender !== meId) return { error: '❌ Apenas admins podem iniciar a divulgação.' };

    let metadata;
    try {
        metadata = await sock.groupMetadata(from);
    } catch (e) {
        return { error: '❌ Não consegui ler os membros do grupo.' };
    }

    const targets = metadata.participants
        .map(p => p.id)
        .filter(id => id && id !== meId && !admins.includes(id));

    const sample = targets.slice(0, 3).map(jid => jid.split('@')[0]).join(', ') || '—';
    const minutos = targets.length === 0 ? 0 : Math.ceil(targets.length * 75 / 60);

    const alvoTexto = targets.length === 0
        ? '⚠️ *Nenhum membro comum encontrado.* Este grupo só tem admins e/ou bots.'
        : `${targets.length}`;

    const previewText =
`📋 *Pré-visualização da divulgação*

🔗 *Link configurado:*
${link}

👥 *Grupo:* ${metadata.subject}
📊 *Membros totais:* ${metadata.participants.length}
🛡️ *Admins:* ${admins.length} (serão *ignorados*)
🤖 *Bots:* 1 (será ignorado)
🎯 *Alvos reais (só membros comuns):* ${alvoTexto}

⏱️ *Delay entre envios:* 45s a 105s (randômico)
⏰ *Tempo estimado:* ~${minutos} min

👀 *Exemplo de quem receberá:*
${sample} ...

💬 *Exemplo de mensagem que será enviada (com preview do WhatsApp):*
${TEMPLATES[0]('55999XXXXXXX', link)}

Para *iniciar*, responda com: *!divulgar confirmar*
Para *cancelar*, ignore esta mensagem.`;

    return { previewText, metadata, targets, admins };
}

async function runDivulgacao(sock, m, ctx) {
    const { from, sender, lastBotResponse, GLOBAL_COOLDOWN, react } = ctx;

    const link = getGroupLink();
    if (!link) return sock.sendMessage(from, { text: '❌ Nenhum link configurado. Use !setlink <link> primeiro.' }, { quoted: m });

    const meId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const admins = await getAdmins(sock, from);
    if (!admins.includes(sender) && sender !== meId) {
        return sock.sendMessage(from, { text: '❌ Apenas admins podem iniciar a divulgação.' }, { quoted: m });
    }

    let metadata;
    try {
        metadata = await sock.groupMetadata(from);
    } catch (e) {
        return sock.sendMessage(from, { text: '❌ Não consegui ler os membros do grupo.' }, { quoted: m });
    }

    const targets = metadata.participants
        .map(p => p.id)
        .filter(id => id && id !== meId && !admins.includes(id));

    if (targets.length === 0) {
        warn(`Divulgar cancelado: grupo ${metadata.subject} (${from}) só tem admins/bot. Nenhum alvo.`);
        try { await sock.sendMessage(from, { react: { text: '🚫', key: m.key } }); } catch (_) {}
        return sock.sendMessage(from, {
            text: `🚫 *Nada para divulgar.*\n\nO grupo *${metadata.subject}* só tem admins (e o bot). Não há membros comuns pra receber o link.\n\nAdicione alguém ao grupo ou libere o bot da lista de admins pra ele aparecer como alvo.`
        }, { quoted: m });
    }

    head(`Divulgação confirmada em ${metadata.subject} (${from})`);
    info(`Total de alvos (sem bots/admins): ${targets.length}`);

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
        const { from, isGroup, sender, lastBotResponse, GLOBAL_COOLDOWN, react, fullArgsText } = ctx;
        const text = (fullArgsText || '').trim().toLowerCase();

        if (!isGroup) {
            return sock.sendMessage(from, { text: '❌ Use este comando dentro do grupo que você quer divulgar.' }, { quoted: m });
        }

        if (text === 'cancelar' || text === 'cancel') {
            return sock.sendMessage(from, { text: 'ℹ️ Divulgação não iniciada (ou já em andamento — reinicie o bot para abortar).' }, { quoted: m });
        }

        if (text === 'confirmar' || text === 'confirma' || text === 'go') {
            return runDivulgacao(sock, m, ctx);
        }

        const result = await buildPreview(sock, from, sender);
        if (result.error) {
            return sock.sendMessage(from, { text: result.error }, { quoted: m });
        }

        head(`Preview solicitada em ${result.metadata.subject} (${from})`);
        info(`Alvos (sem admins/bot): ${result.targets.length}`);

        return sock.sendMessage(from, { text: result.previewText }, { quoted: m });
    }
};
