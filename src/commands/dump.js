const fs = require('fs');
const { buildDumpZip, cleanupDumpZip } = require('../services/dump');

module.exports = {
    name: 'dump',
    category: 'admin',
    description: 'Gera um backup dos arquivos do banco de dados e configurações (inclui .env com API keys)',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '📦', lastBotResponse, GLOBAL_COOLDOWN);

        let zipPath = null;
        try {
            const { zipPath: builtPath, zipName, caption } = buildDumpZip();
            zipPath = builtPath;

            await sock.sendMessage(from, {
                document: fs.readFileSync(zipPath),
                fileName: zipName,
                mimetype: 'application/zip',
                caption
            }, { quoted: m });

            fs.unlinkSync(zipPath);
            zipPath = null;
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);

        } catch (error) {
            console.error('Erro ao gerar dump:', error);
            await sock.sendMessage(from, { text: `❌ Erro ao gerar dump: ${error.message}` }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        } finally {
            if (zipPath) cleanupDumpZip(zipPath);
        }

        return currentBotResponse;
    }
};
