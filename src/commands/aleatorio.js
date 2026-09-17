const { formatFicha, readFotoBuffer } = require('../services/ficha');

module.exports = {
    name: 'aleatorio',
    aliases: ['sortear-ficha', 'random-ficha', 'sortear', 'random-pessoa', 'sorteio-ficha'],
    category: 'geral',
    description: 'Sorteia uma ficha aleatória (!aleatorio)',
    async execute(sock, m, { from, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, pessoaAleatoria, countPessoas } = utils;
        let current = await react(sock, m, '🎲', lastBotResponse, GLOBAL_COOLDOWN);
        if (countPessoas() === 0) {
            await sock.sendMessage(from, { text: `🎲 Nenhuma ficha para sortear.\n\n💡 *${config.prefix}cadastrar-pessoa Nome | 15/08/2000 | Cidade | Descrição*` }, { quoted: m });
            return current;
        }
        const p = pessoaAleatoria();
        if (!p) {
            await sock.sendMessage(from, { text: '❌ Falha ao sortear. Tente de novo.' }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        const caption = `🎲 *Sorteado!*\n\n` + formatFicha(p, getBotName(from, config));
        const buf = readFotoBuffer(p.foto_path);
        if (buf) await sock.sendMessage(from, { image: buf, caption }, { quoted: m });
        else await sock.sendMessage(from, { text: caption }, { quoted: m });
        return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
    }
};
