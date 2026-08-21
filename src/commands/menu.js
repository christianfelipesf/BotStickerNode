const fs = require('fs');
const path = require('path');

const MENUS_DIR = path.join(process.cwd(), 'src', 'media', 'menus');
const VALID_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function listMenuImages() {
    try {
        if (!fs.existsSync(MENUS_DIR)) return [];
        return fs.readdirSync(MENUS_DIR)
            .filter(f => VALID_EXT.has(path.extname(f).toLowerCase()))
            .map(f => path.join(MENUS_DIR, f));
    } catch (_) { return []; }
}

function pickRandomMenuImage() {
    const images = listMenuImages();
    if (images.length === 0) return null;
    return images[Math.floor(Math.random() * images.length)];
}

module.exports = {
    name: 'menu',
    aliases: ['help', 'comandos'],
    category: 'geral',
    description: 'Exibe o menu de comandos',
    async execute(sock, m, { from, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, getGroupData } = utils;

        let currentBotResponse = await react(sock, m, '📖', lastBotResponse, GLOBAL_COOLDOWN);
        const currentBotName = getBotName(from, config);
        const groupData = getGroupData(from);

        const menuText = `*${currentBotName}*\n\n╭─── *GERAL* ───\n│ 📂 *${config.prefix}menu*\n│ 📊 *${config.prefix}status*\n│ 👤 *${config.prefix}perfil*\n│ 🤖 *${config.prefix}ai* <texto>\n╰───────────────\n\n╭─── *ADMIN* ───\n│ 🚫 *${config.prefix}ban* (marque)\n│ ⚠️ *${config.prefix}adv* (marque)\n│ 🛡️ *${config.prefix}antilink*\n│ 🔇 *${config.prefix}mute* (marque)\n│ 🔊 *${config.prefix}desmute* (marque)\n│ 🧹 *${config.prefix}limpar* [n]\n╰───────────────\n\n╭─── *MÍDIA* ───\n│ 🖼️ *${config.prefix}s* (sticker)\n│ 🔄 *${config.prefix}toimg*\n│ 🎞️ *${config.prefix}togif*\n│ 🔓 *${config.prefix}revelar*\n│ 🎵 *${config.prefix}play* <nome>\n│ 📥 *${config.prefix}dl* <link>\n│ 📥 *${config.prefix}dhd* <link>\n│ 🗣️ *${config.prefix}tts* <texto>\n│ ⚡ *${config.prefix}acelerar*\n│ 🐌 *${config.prefix}desacelerar*\n╰───────────────\n\n╭─── *GRUPOS* ───\n│ 📢 *${config.prefix}mencionar*\n│ 📝 *${config.prefix}resumir*\n│ 🏷️ *${config.prefix}nome* <nome>\n│ 🖼️ *${config.prefix}imagem* (marque)\n│ 🔗 *${config.prefix}linkgp*\n╰───────────────\n\n╭─── *CONFIG* ───\n│ ⚙️ *${config.prefix}config*\n│ 🛠️ *${config.prefix}set* <parâm> <valor>\n╰───────────────\n\n╭─── *SISTEMA* ───\n│ 📦 *${config.prefix}dump*\n│ 🏰 *${config.prefix}grupos*\n╰───────────────\n\n_📖 ${config.prefix}menuadmin — comandos de admin_\n_👑 ${config.prefix}menudono — comandos do dono_`;

        // Escolhe imagem do menu:
        // 1. Imagem customizada por grupo (definida com !imagem)
        // 2. Imagem aleatória de src/media/menus
        // 3. Fallback: src/media/logo.png
        let menuImagePath = null;
        if (groupData.menuImage) {
            const potentialPath = path.isAbsolute(groupData.menuImage)
                ? groupData.menuImage
                : path.join(process.cwd(), groupData.menuImage);

            if (fs.existsSync(potentialPath)) {
                menuImagePath = potentialPath;
            }
        }

        if (!menuImagePath) {
            menuImagePath = pickRandomMenuImage();
        }

        if (!menuImagePath) {
            menuImagePath = path.join(process.cwd(), 'src', 'media', 'logo.png');
        }

        if (config.showLogoInMenu && menuImagePath && fs.existsSync(menuImagePath)) {
            await sock.sendMessage(from, { image: { url: menuImagePath }, caption: menuText }, { quoted: m });
        } else {
            await sock.sendMessage(from, { text: menuText }, { quoted: m });
        }

        return currentBotResponse;
    }
};
