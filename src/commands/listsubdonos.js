module.exports = {
    name: 'listsubdonos',
    aliases: ['listsubowners', 'subdonos', 'listasubdonos'],
    category: 'admin',
    description: 'Lista os sub-donos autorizados a configurar o bot. Dono e sub-donos podem ver.',
    async execute(sock, m, { from, sender, utils }) {
        const access = utils.canConfigureBot
            ? utils.canConfigureBot(sock, m, sender, from)
            : { ok: utils.isBotOwner(sock, m, sender) };
        if (!access.ok) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono ou sub-donos podem usar este comando.' }, { quoted: m });
        }

        const list = utils.getSubOwners ? utils.getSubOwners() : [];
        if (!list.length) {
            return await sock.sendMessage(from, { text: '📋 *Sub-donos (0)*\n\nNenhum sub-dono cadastrado.\n➕ *!addsubdono <numero>* (só o dono)' }, { quoted: m });
        }
        const lines = list.map((p, i) => `${i + 1}. +${p}`);
        const text = `📋 *Sub-donos (${list.length})*\n\n${lines.join('\n')}\n\n💡 Eles podem usar *!set* e *!config*.\n➕ *!addsubdono <numero>* • ➖ *!remsubdono <numero>* (só o dono)`;
        await sock.sendMessage(from, { text }, { quoted: m });
    }
};
