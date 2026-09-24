module.exports = {
    name: 'config',
    category: 'config',
    description: 'Exibe as configurações atuais do bot',
    async execute(sock, m, { from, sender, config, utils }) {
        const access = typeof utils.canConfigureBot === 'function'
            ? utils.canConfigureBot(sock, m, sender, from)
            : { ok: (() => { const meId = utils.normalizeJid(sock.user.id); const senderNorm = utils.normalizeJid(sender); return m.key.fromMe === true || sender === meId || senderNorm === meId; })() };
        if (!access.ok) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono ou sub-donos podem usar este comando.' }, { quoted: m });
        }

        const cfgTxt = `⚙️ *CONFIGURAÇÕES*\n\n🤖 *Nome:* ${config.botName}\n⌨️ *Prefixo:* ${config.prefix}\n🖼️ *Logo Menu:* ${config.showLogoInMenu ? 'Sim' : 'Não'}\n📝 *Limite Resumo:* ${config.summaryLimit}\n\n*Prompts:* Para ver use ${config.prefix}set <aiPrompt/summaryPrompt>\n\n*Mudar:* ${config.prefix}set <parâmetro> <valor>`;
        await sock.sendMessage(from, { text: cfgTxt }, { quoted: m });
    }
};
