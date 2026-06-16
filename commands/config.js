module.exports = {
    name: 'config',
    category: 'config',
    description: 'Exibe as configurações atuais do bot',
    async execute(sock, m, { from, config }) {
        const cfgTxt = `⚙️ *CONFIGURAÇÕES*\n\n🤖 *Nome:* ${config.botName}\n⌨️ *Prefixo:* ${config.prefix}\n🖼️ *Logo Menu:* ${config.showLogoInMenu ? 'Sim' : 'Não'}\n📝 *Limite Resumo:* ${config.summaryLimit}\n\n*Prompts:* Para ver use ${config.prefix}set <aiPrompt/summaryPrompt>\n\n*Mudar:* ${config.prefix}set <parâmetro> <valor>`;
        await sock.sendMessage(from, { text: cfgTxt }, { quoted: m });
    }
};
