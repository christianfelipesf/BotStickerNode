const { formatContato, readFotoBuffer } = require('../services/ficha');

module.exports = {
    name: 'contato',
    aliases: ['pix', 'contato-pessoa', 'insta-ficha', 'redes'],
    category: 'geral',
    description: 'Exibe contatos da ficha (!contato <Nome>)',
    async execute(sock, m, { from, config, utils, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, getPessoa, searchPessoas } = utils;
        let current = await react(sock, m, '💸', lastBotResponse, GLOBAL_COOLDOWN);
        const nome = String(fullArgsText || '').trim().replace(/^(pix|contato)\s+/i, '').trim();
        if (!nome) {
            await sock.sendMessage(from, { text: `💸 *Contato*\n\nUse: *${config.prefix}contato <Nome>*\nEx: *${config.prefix}contato Eduarda*` }, { quoted: m });
            return current;
        }
        const p = getPessoa(nome);
        if (!p) {
            const similar = searchPessoas(nome, 5).map(x => `• ${x.nome}`).join('\n');
            await sock.sendMessage(from, { text: `❌ Ficha *${nome.slice(0, 40)}* não encontrada.${similar ? `\n\n🔎 Parecidas:\n${similar}` : ''}` }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        const caption = formatContato(p, getBotName(from, config));
        const buf = readFotoBuffer(p.foto_path);
        if (buf) await sock.sendMessage(from, { image: buf, caption }, { quoted: m });
        else await sock.sendMessage(from, { text: caption }, { quoted: m });
        return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
    }
};
