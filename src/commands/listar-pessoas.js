const { formatNascimento } = require('../services/ficha');

module.exports = {
    name: 'listar-pessoas',
    aliases: ['fichas', 'lista-fichas', 'listar-fichas', 'pessoas', 'listar'],
    category: 'geral',
    description: 'Lista fichas cadastradas (!listar-pessoas [página|busca])',
    async execute(sock, m, { from, config, utils, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, listPessoas, countPessoas, searchPessoas } = utils;
        let current = await react(sock, m, '📋', lastBotResponse, GLOBAL_COOLDOWN);
        const raw = String(fullArgsText || '').trim();
        const total = countPessoas();
        if (total === 0) {
            await sock.sendMessage(from, { text: `📋 Nenhuma ficha cadastrada.\n\n💡 *${config.prefix}cadastrar-pessoa Nome | 15/08/2000 | Cidade | Descrição*` }, { quoted: m });
            return current;
        }
        const PER_PAGE = 10;
        const num = Number(raw);
        if (raw && Number.isNaN(num)) {
            // busca por nome
            const found = searchPessoas(raw, 10);
            if (!found.length) {
                await sock.sendMessage(from, { text: `🔎 Nada encontrado para *${raw.slice(0, 40)}*.` }, { quoted: m });
                return current;
            }
            let txt = `╭─── *🔎 BUSCA: ${raw.slice(0, 30)}* ───\n`;
            found.forEach((p, i) => { txt += `│ ${i + 1}. *${p.nome}* — ${p.cidade || '—'} (${formatNascimento(p.nascimento)})\n`; });
            txt += `│ 📋 *Total fichas:* ${total}\n╰───────────────`;
            await sock.sendMessage(from, { text: txt }, { quoted: m });
            return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
        }
        const page = Math.max(1, num || 1);
        const pages = Math.max(1, Math.ceil(total / PER_PAGE));
        const cur = Math.min(page, pages);
        const rows = listPessoas(PER_PAGE, (cur - 1) * PER_PAGE);
        let txt = `╭─── *📋 FICHAS (${total}) — pág. ${cur}/${pages}* ───\n`;
        rows.forEach((p, i) => {
            const n = (cur - 1) * PER_PAGE + i + 1;
            txt += `│ ${n}. *${p.nome}* — ${p.cidade || '—'} (${formatNascimento(p.nascimento)})\n`;
        });
        txt += `│ 💡 *${config.prefix}ficha <Nome>* para ver • *${config.prefix}listar-pessoas ${cur + 1}* próxima\n`;
        txt += `│ 🤖 *Por:* ${getBotName(from, config)}\n╰───────────────`;
        await sock.sendMessage(from, { text: txt }, { quoted: m });
        return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
    }
};
