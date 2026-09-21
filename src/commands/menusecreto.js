module.exports = {
    name: 'menusecreto',
    aliases: ['menusecret', 'segredos', 'secretmenu'],
    category: 'geral',
    description: 'Exibe comandos secretos, ocultos do !menu (ex.: !nuke)',
    async execute(sock, m, { from, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName } = utils;
        const botName = getBotName(from, config);
        const p = config.prefix;

        let currentBotResponse = lastBotResponse;
        try { currentBotResponse = await react(sock, m, '🤫', lastBotResponse, GLOBAL_COOLDOWN); } catch (_) {}

        const text = `*${botName} — Menu Secreto* 🤫\n_comandos ocultos do !menu_\n\n` +
            `╭─── *TROLL* ───\n` +
            `│ ☢️ *${p}nuke* @user — finge explodir o grupo (alias ${p}bomba, não bane ninguém)\n` +
            `╰───────────────\n\n` +
            `╭─── *SISTEMA* ───\n` +
            `│ 🏓 *${p}ping* — latência real com o Google\n` +
            `│ 🚪 *${p}subcancel* — cancela login de sub-sessão na fila\n` +
            `╰───────────────`;

        await sock.sendMessage(from, { text }, { quoted: m });
        return currentBotResponse;
    }
};
