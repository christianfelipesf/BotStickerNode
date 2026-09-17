const { formatFicha, readFotoBuffer } = require('../services/ficha');

module.exports = {
    name: 'ficha',
    aliases: ['pessoa', 'fichap', 'ver-ficha', 'verficha'],
    category: 'geral',
    description: 'Exibe a ficha cadastrada de uma pessoa (!ficha <Nome>)',
    async execute(sock, m, { from, config, utils, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, getPessoa, searchPessoas } = utils;
        let current = await react(sock, m, '📇', lastBotResponse, GLOBAL_COOLDOWN);
        const nome = String(fullArgsText || '').trim();
        if (!nome) {
            await sock.sendMessage(from, {
                text: `📇 *Ficha de perfil*\n\nUse: *${config.prefix}ficha <Nome>*\nEx: *${config.prefix}ficha Eduarda*\n\n💡 Cadastre com *${config.prefix}cadastrar-pessoa Nome | 15/08/2000 | Cidade | Descrição* (responda a foto para incluir)`
            }, { quoted: m });
            return current;
        }
        const p = getPessoa(nome);
        if (!p) {
            const similar = searchPessoas(nome, 5).map(x => `• ${x.nome}`).join('\n');
            await sock.sendMessage(from, {
                text: `❌ Ficha *${nome.slice(0, 40)}* não encontrada.${similar ? `\n\n🔎 Parecidas:\n${similar}` : `\n\n💡 Cadastre com *${config.prefix}cadastrar-pessoa ${nome.slice(0, 30)} | ...*`}`
            }, { quoted: m });
            current = await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
            return current;
        }
        const caption = formatFicha(p, getBotName(from, config));
        const buf = readFotoBuffer(p.foto_path);
        if (buf) await sock.sendMessage(from, { image: buf, caption }, { quoted: m });
        else await sock.sendMessage(from, { text: caption + `\n│ 🖼️ *Foto:* sem foto cadastrada` }, { quoted: m });
        current = await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
        return current;
    }
};
