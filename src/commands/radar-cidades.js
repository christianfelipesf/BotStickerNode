module.exports = {
    name: 'radar-cidades',
    aliases: ['radar', 'cidades', 'radar-cidade', 'por-cidade'],
    category: 'geral',
    description: 'Lista fichas por cidade (!radar-cidades [Cidade])',
    async execute(sock, m, { from, config, utils, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, pessoasPorCidade, agruparCidades, countPessoas } = utils;
        let current = await react(sock, m, '📍', lastBotResponse, GLOBAL_COOLDOWN);
        const cidade = String(fullArgsText || '').trim();
        if (!cidade) {
            const groups = agruparCidades();
            if (!groups.length) {
                await sock.sendMessage(from, { text: `📍 *Radar de cidades*\n\n_Nenhuma ficha com cidade cadastrada._` }, { quoted: m });
                return current;
            }
            let txt = `╭─── *📍 RADAR DE CIDADES* ───\n`;
            groups.slice(0, 20).forEach((g) => { txt += `│ 📍 *${g.cidade}* — ${g.total} pessoa(s)\n`; });
            txt += `│ 💡 Use *${config.prefix}radar-cidades <Cidade>* para detalhar\n`;
            txt += `│ 🤖 *Por:* ${getBotName(from, config)}\n╰───────────────`;
            await sock.sendMessage(from, { text: txt }, { quoted: m });
            return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
        }
        const rows = pessoasPorCidade(cidade);
        if (!rows.length) {
            await sock.sendMessage(from, { text: `📍 Ninguém de *${cidade.slice(0, 60)}* cadastrado.\n\n💡 Total fichas: ${countPessoas()}` }, { quoted: m });
            return current;
        }
        let txt = `╭─── *📍 RADAR: ${cidade.slice(0, 40)} (${rows.length})* ───\n`;
        rows.slice(0, 30).forEach((p) => { txt += `│ 👤 *${p.nome}* — ${p.cidade || '—'}\n`; });
        if (rows.length > 30) txt += `│ _... e mais ${rows.length - 30}_\n`;
        txt += `│ 🤖 *Por:* ${getBotName(from, config)}\n╰───────────────`;
        await sock.sendMessage(from, { text: txt }, { quoted: m });
        return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
    }
};
