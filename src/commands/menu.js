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

        const p = config.prefix;
        const menuText = `*${currentBotName} — Menu Principal* 📖\n_comandos principais_\n\n` +
            `╭─── *GERAL* ───\n` +
            `│ 👤 *${p}perfil* — foto do perfil\n` +
            `│ 📊 *${p}status* — info do bot\n` +
            `│ 🤖 *${p}ai* <texto> — conversa com IA\n` +
            `│ 🌐 *${p}traduzir* <texto> — traduz\n` +
            `│ 📖 *${p}tutorial* — guia de uso\n` +
            `│ 📝 *${p}resumir* — resume conversa\n` +
            `│ 🐛 *${p}bug* <msg> — reportar bug\n` +
            `│ 💡 *${p}sugestao* <msg> — enviar sugestão\n` +
            `╰───────────────\n\n` +
            `╭─── *MÍDIA* ───\n` +
            `│ 🖼️ *${p}s* — cria sticker\n` +
            `│ 🏷️ *${p}rename* pack/autor — pack e autor do sticker\n` +
            `│ 🔓 *${p}revelar* — revela view once\n` +
            `│ 🔄 *${p}toimg* — sticker → mídia (alias: togif/gif)\n` +
            `│ ✨ *${p}stexto* <texto> — sticker de texto\n` +
            `│ 🎵 *${p}play* <nome> — baixa música\n` +
            `│ 📥 *${p}dl* <link> — download\n` +
            `│ 📥 *${p}dhd* <link> — download HD\n` +
            `│ 🗣️ *${p}tts* <texto> — texto → áudio\n` +
            `│ ⚡ *${p}acelerar* • 🐌 *${p}desacelerar* — áudio/vídeo\n` +
            `╰───────────────\n\n` +
            `╭─── *INTERAÇÃO* ───\n` +
            `│ 💞 *${p}comandosinteracao* — beijar, abraço etc\n` +
            `╰───────────────\n\n` +
            `╭─── *OUTROS* ───\n` +
            `│ 📖 *${p}menuadmin* — comandos de admin\n` +
            `│ 👑 *${p}menudono* — comandos do dono\n` +
            `╰───────────────`;

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
