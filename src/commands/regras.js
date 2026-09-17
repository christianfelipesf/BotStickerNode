module.exports = {
    name: 'regras',
    aliases: ['rules', 'regra', 'setregras', 'definirregras'],
    description: 'Exibe as regras. Admin define com: !regras set <texto> | !regras limpar',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        const full = (args || []).join(' ').trim();
        const lower = full.toLowerCase();

        // Leitura liberada para todos quando sem argumentos
        if (!full) {
            const gd = utils.getGroupData(from) || {};
            const regras = (gd.regras || gd.extra?.regras || '').toString().trim();
            if (!regras) {
                return await sock.sendMessage(from, { text: 'ℹ️ Este grupo ainda não tem regras definidas. Um admin pode definir com: !regras set <texto>' }, { quoted: m });
            }
            return await sock.sendMessage(from, { text: `📜 *Regras do grupo*\n\n${regras}` }, { quoted: m });
        }

        // Escrita: só admin
        const admins = await utils.getAdmins(sock, from);
        if (!utils.isUserAdmin(sender, admins)) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem definir as regras.' }, { quoted: m });
        }

        if (lower === 'limpar' || lower === 'clear' || lower === 'reset' || lower === 'apagar') {
            utils.setGroupData(from, { regras: null });
            await utils.react(sock, m, '🗑️', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, { text: '🗑️ Regras apagadas.' }, { quoted: m });
        }

        let texto = full;
        if (lower.startsWith('set ')) texto = full.slice(4).trim();
        else if (lower.startsWith('definir ')) texto = full.slice(8).trim();
        if (!texto) {
            return await sock.sendMessage(from, { text: '❌ Use: !regras set <texto das regras>' }, { quoted: m });
        }
        if (texto.length > 2000) {
            return await sock.sendMessage(from, { text: '❌ Regras muito longas (máx. 2000 caracteres).' }, { quoted: m });
        }

        utils.setGroupData(from, { regras: texto });
        await utils.react(sock, m, '📜', lastBotResponse, GLOBAL_COOLDOWN);
        return await sock.sendMessage(from, { text: `📜 *Regras atualizadas*\n\n${texto}` }, { quoted: m });
    }
};
