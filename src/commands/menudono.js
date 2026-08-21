module.exports = {
    name: 'menudono',
    aliases: ['menubot', 'donoh', 'menuowner'],
    category: 'geral',
    description: 'Exibe comandos exclusivos do dono do bot (ocultos do !menu)',
    async execute(sock, m, { from, sender, config, utils }) {
        const { normalizeJid, getBotName } = utils;
        const botName = getBotName(from, config);
        const p = config.prefix;

        const meId = normalizeJid(sock.user?.id || '');
        const senderNorm = normalizeJid(sender);
        const isOwner = m.key.fromMe || sender === meId || senderNorm === meId;

        if (!isOwner) {
            return sock.sendMessage(from, { text: '❌ Apenas o *dono do bot* pode usar este comando.' }, { quoted: m });
        }

        const text = `*${botName} — Menu Dono* 👑\n_comandos ocultos do !menu_\n\n` +
            `╭─── *ATIVAÇÃO* ───\n` +
            `│ ✅ *${p}ativar* / *${p}desativar* — liga/desliga bot no grupo\n` +
            `│ ⚙️ *${p}ativarp* / *${p}desativarp* — modo parcial (só mídia)\n` +
            `╰───────────────\n\n` +
            `╭─── *DASHBOARD* ───\n` +
            `│ 📊 *${p}dashboard* / *${p}dash* — ativa/desativa log do grupo\n` +
            `│ 🔌 *${p}dashboardativar* / *${p}dashboarddesativar* — global\n` +
            `│ 🗑️ *${p}dashdel* <jid> — remove grupo do painel\n` +
            `│ 📋 *${p}dashlist* — lista acessos ao painel\n` +
            `│ ♻️ *${p}dashreset* — reseta logs/mídias\n` +
            `╰───────────────\n\n` +
            `╭─── *DIVULGAÇÃO* ───\n` +
            `│ 📢 *${p}divulgar* / *${p}divulgar confirmar* — envia link por DM\n` +
            `│ 🔗 *${p}setlink* <link> — define link do divulgar\n` +
            `╰───────────────\n\n` +
            `╭─── *SUB-SESSÕES* ───\n` +
            `│ 🔐 *${p}login* — parear sub-sessão (QR/código)\n` +
            `│ 📃 *${p}logins* — lista sub-sessões ativas\n` +
            `│ 🚪 *${p}logoff* — encerra sua sub-sessão\n` +
            `│ 🧹 *${p}subclean* — limpa sub-sessão do disco\n` +
            `│ 🧹 *${p}subcleanall* — limpa todas\n` +
            `│ 🐛 *${p}subdebug* — diagnóstico\n` +
            `╰───────────────\n\n` +
            `╭─── *FEED / NEWS* ───\n` +
            `│ 📰 *${p}news* — ativa/desativa no grupo\n` +
            `│ 📰 *${p}newsativar* / *${p}newsdesativar* — global\n` +
            `│ 🗑️ *${p}newsreset* — reseta posts vistos\n` +
            `╰───────────────\n\n` +
            `╭─── *SISTEMA* ───\n` +
            `│ 🔄 *${p}restart* — reinicia via pm2\n` +
            `│ 📥 *${p}update* / *${p}updateres* — git pull + restart\n` +
            `│ 📄 *${p}log* — envia logs do terminal\n` +
            `│ 🔧 *${p}setprefix* <prefix> / *${p}set* — configs\n` +
            `│ 📦 *${p}dump* / *${p}grupos* — diagnóstico\n` +
            `╰───────────────\n\n` +
            `╭─── *TRANSMISSÃO* ───\n` +
            `│ 📣 *${p}transmitir* / *${p}transmitirall* — broadcast\n` +
            `╰───────────────`;

        return sock.sendMessage(from, { text }, { quoted: m });
    }
};
