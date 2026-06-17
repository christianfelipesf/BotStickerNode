const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'menu',
    aliases: ['help'],
    category: 'geral',
    description: 'Exibe o menu de comandos',
    async execute(sock, m, { from, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, getGroupData } = utils;

        let currentBotResponse = await react(sock, m, '📖', lastBotResponse, GLOBAL_COOLDOWN);
        const currentBotName = getBotName(from, config);
        const groupData = getGroupData(from);

        const menuText = `*${currentBotName}*\n\n╭─── *GERAL* ───\n│ 📂 *${config.prefix}menu*\n│ 📊 *${config.prefix}status*\n│ 👤 *${config.prefix}perfil*\n│ 🤖 *${config.prefix}ai* <texto>\n╰───────────────\n\n╭─── *ADMIN* ───\n│ 🚫 *${config.prefix}ban* (marque)\n│ ⚠️ *${config.prefix}adv* (marque)\n│ 🛡️ *${config.prefix}antilink*\n│ 🔇 *${config.prefix}mute* (marque)\n│ 🔊 *${config.prefix}desmute* (marque)\n╰───────────────\n\n╭─── *MÍDIA* ───\n│ 🖼️ *${config.prefix}s* (sticker)\n│ 🔄 *${config.prefix}toimg*\n│ 🔓 *${config.prefix}revelar*\n│ 🎵 *${config.prefix}play* <nome>\n│ 📥 *${config.prefix}dl* <link>\n│ 📥 *${config.prefix}dhd* <link>\n│ 🗣️ *${config.prefix}tts* <texto>\n│ ⚡ *${config.prefix}acelerar*\n│ 🐌 *${config.prefix}desacelerar*\n╰───────────────\n\n╭─── *GRUPOS* ───\n│ ✅ *${config.prefix}ativar*\n│ ❌ *${config.prefix}desativar*\n│ 📢 *${config.prefix}mencionar*\n│ 📝 *${config.prefix}resumir*\n│ 🏷️ *${config.prefix}nome* <nome>\n│ 🖼️ *${config.prefix}imagem* (marque)\n╰───────────────\n\n╭─── *CONFIG* ───\n│ ⚙️ *${config.prefix}config*\n│ 🛠️ *${config.prefix}set* <parâm> <valor>\n╰───────────────\n\n╭─── *SISTEMA* ───\n│ 📦 *${config.prefix}dump*\n│ 🏰 *${config.prefix}grupos*\n╰───────────────`;

        let menuImagePath = path.join(process.cwd(), 'logo.png');
        if (groupData.menuImage) {
            const potentialPath = path.isAbsolute(groupData.menuImage)
                ? groupData.menuImage
                : path.join(process.cwd(), groupData.menuImage);

            if (fs.existsSync(potentialPath)) {
                menuImagePath = potentialPath;
            }
        }

        if (config.showLogoInMenu && fs.existsSync(menuImagePath)) {
            await sock.sendMessage(from, { image: { url: menuImagePath }, caption: menuText }, { quoted: m });
        } else {
            await sock.sendMessage(from, { text: menuText }, { quoted: m });
        }

        return currentBotResponse;
    }
};
