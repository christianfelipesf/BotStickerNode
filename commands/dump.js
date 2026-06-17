const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

module.exports = {
    name: 'dump',
    category: 'admin',
    description: 'Gera um backup dos arquivos do banco de dados e configurações',
    async execute(sock, m, { from, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        
        let currentBotResponse = await react(sock, m, '📦', lastBotResponse, GLOBAL_COOLDOWN);
        
        const zip = new AdmZip();
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        
        const zipName = `dump_${Date.now()}.zip`;
        const zipPath = path.join(tempDir, zipName);

        try {
            // Arquivos para incluir no dump
            const filesToInclude = [
                'database.json',
                'messages.json',
                'package.json',
                '.env'
            ];

            filesToInclude.forEach(file => {
                const filePath = path.join(process.cwd(), file);
                if (fs.existsSync(filePath)) {
                    zip.addLocalFile(filePath);
                }
            });

            // Incluir diretórios importantes se existirem (ex: uploads)
            const uploadsDir = path.join(process.cwd(), 'uploads');
            if (fs.existsSync(uploadsDir)) {
                zip.addLocalFolder(uploadsDir, 'uploads');
            }

            zip.writeZip(zipPath);

            await sock.sendMessage(from, { 
                document: fs.readFileSync(zipPath),
                fileName: zipName,
                mimetype: 'application/zip',
                caption: `📦 *Backup Gerado com Sucesso!*\n\nContém:\n- Bancos de dados\n- Configurações\n- Uploads (Imagens de Menu)`
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
