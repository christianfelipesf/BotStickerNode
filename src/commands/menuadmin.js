module.exports = {
    name: 'menuadmin',
    aliases: ['adminmenu', 'adminhelp', 'menugp'],
    category: 'admin',
    description: 'Exibe comandos de administrador (ocultos do !menu)',
    async execute(sock, m, { from, isGroup, sender, config, utils }) {
        const { getAdmins, isUserAdmin, normalizeJid, getBotName } = utils;
        const botName = getBotName(from, config);
        const p = config.prefix;

        if (!isGroup) {
            return sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
        }

        const meId = normalizeJid(sock.user?.id || '');
        const senderNorm = normalizeJid(sender);
        const isOwner = m.key.fromMe || sender === meId || senderNorm === meId;

        let isAdmin = isOwner;
        if (!isAdmin) {
            try {
                const admins = await getAdmins(sock, from);
                isAdmin = isUserAdmin(sender, admins);
            } catch (_) { isAdmin = false; }
        }

        if (!isAdmin) {
            return sock.sendMessage(from, { text: '❌ Apenas *admins* do grupo podem usar este comando.' }, { quoted: m });
        }

        const text = `*${botName} — Menu Admin* 🛡️\n_comandos de administração_\n\n` +
            `╭─── *MODERAÇÃO* ───\n` +
            `│ 🚫 *${p}ban* (marque/responda) — remove membro\n` +
            `│ ⛔ *${p}listanegra* [@/nº] — lista negra com auto-ban ao voltar\n` +
            `│ ⚠️ *${p}adv* (marque) — advertência 3/3 = ban\n` +
            `│ ✅ *${p}limparadv* [@user|all] — limpa advertências\n` +
            `│ 🛡️ *${p}antilink* — ativa/desativa filtro de links\n` +
            `│ 🔇 *${p}mute* @user — silencia\n` +
            `│ 🔊 *${p}desmute* @user — dessilencia\n` +
            `│ 🧹 *${p}limpar* [n] — apaga mensagens\n` +
            `│ 🗑️ *${p}deletarmsg* (responda) — apaga mensagem marcada\n` +
            `╰───────────────\n\n` +
            `╭─── *GRUPO* ───\n` +
            `│ 📢 *${p}mencionar* [texto] — marca todos\n` +
            `│ 💬 *${p}cita* (responda mensagem) — reescreve marcando todos\n` +
            `│ 🏷️ *${p}nome* <nome> — nome do bot no grupo\n` +
            `│ 🖼️ *${p}imagem* (responda imagem) — imagem do menu\n` +
            `│ 🔗 *${p}linkgp* — pega link do grupo (bot precisa ser admin)\n` +
            `│ 🔗 *${p}setlink* <link> — define link p/ !divulgar\n` +
            `╰───────────────\n\n` +
            `_Use ${p}menudono para comandos do dono do bot._`;

        return sock.sendMessage(from, { text }, { quoted: m });
    }
};
