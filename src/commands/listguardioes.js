module.exports = {
    name: 'listguardioes',
    aliases: ['listguardians', 'guardioes', 'listaguardioes', 'guardians'],
    category: 'admin',
    description: 'Lista os guardiões autorizados. Dono, sub-donos e guardiões podem ver.',
    async execute(sock, m, { from, sender, utils }) {
        let access = utils.canConfigureBot
            ? utils.canConfigureBot(sock, m, sender, from)
            : { ok: utils.isBotOwner(sock, m, sender) };
        if (!access.ok && typeof utils.canGuardianActAsync === 'function') {
            try {
                const g = await utils.canGuardianActAsync(sock, m, sender, from);
                if (g && g.ok) access = { ok: true };
            } catch (_) {}
        }
        if (!access.ok) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono, sub-donos ou guardiões podem usar este comando.' }, { quoted: m });
        }

        const list = utils.getGuardioes ? utils.getGuardioes() : [];
        if (!list.length) {
            return await sock.sendMessage(from, { text: '📋 *Guardiões (0)*\n\nNenhum guardião cadastrado.\n➕ *!addguardiao <numero>* (dono ou subdono)' }, { quoted: m });
        }
        const lines = list.map((p, i) => `${i + 1}. +${p}`);
        const text = `📋 *Guardiões (${list.length})*\n\n${lines.join('\n')}\n\n💡 Podem: *!ativar !desativar !ativarp !desativarp !news !aidono*.\n⛔ Não mexem em configs/chaves API.\n➕ *!addguardiao <numero>* • ➖ *!remguardiao <numero>* (dono ou subdono)`;
        await sock.sendMessage(from, { text }, { quoted: m });
    }
};
