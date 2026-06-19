const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

module.exports = {
    name: 'dump',
    category: 'admin',
    description: 'Gera um backup dos arquivos do banco de dados e configurações',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, flushNow } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '📦', lastBotResponse, GLOBAL_COOLDOWN);

        // Garante que tudo está persistido antes de copiar
        try { flushNow(); } catch (_) {}

        const zip = new AdmZip();
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

        const zipName = `dump_${Date.now()}.zip`;
        const zipPath = path.join(tempDir, zipName);

        try {
            // Arquivos para incluir no dump:
            //  - database.json: configuração editável (config, stats, botName/menuImage)
            //  - bot.db:        estado mutável em alto fluxo (active_groups, group_state, messages)
            //  - bot.db-shm / bot.db-wal: arquivos auxiliares do SQLite em modo WAL
            const filesToInclude = [
                'database.json',
                'bot.db',
                'bot.db-shm',
                'bot.db-wal',
                'package.json',
                '.env'
            ];

            let includedCount = 0;
            let missingCount = 0;
            const includedNames = [];

            filesToInclude.forEach(file => {
                const filePath = path.join(process.cwd(), file);
                if (fs.existsSync(filePath)) {
                    zip.addLocalFile(filePath);
                    includedNames.push(file);
                    includedCount++;
                } else {
                    missingCount++;
                }
            });

            // Incluir diretório uploads (imagens de menu por grupo)
            const uploadsDir = path.join(process.cwd(), 'uploads');
            if (fs.existsSync(uploadsDir)) {
                zip.addLocalFolder(uploadsDir, 'uploads');
            }

            zip.writeZip(zipPath);

            const sizeKb = Math.round(fs.statSync(zipPath).size / 1024);
            const caption = `📦 *Backup Gerado com Sucesso!*\n\n` +
                `📁 *Arquivos incluídos:*\n${includedNames.map(n => `• ${n}`).join('\n')}\n` +
                `📂 *Pasta:* uploads\n\n` +
                `💾 *Tamanho:* ${sizeKb} KB`;

            await sock.sendMessage(from, {
                document: fs.readFileSync(zipPath),
                fileName: zipName,
                mimetype: 'application/zip',
                caption
            }, { quoted: m });

            fs.unlinkSync(zipPath);
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);

        } catch (error) {
            console.error('Erro ao gerar dump:', error);
            await sock.sendMessage(from, { text: `❌ Erro ao gerar dump: ${error.message}` }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};