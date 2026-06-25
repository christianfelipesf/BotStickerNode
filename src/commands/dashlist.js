const fs = require('fs');
const path = require('path');
const { parseAccessLog, buildReport, ACCESS_LOG } = require('../services/dashboardAccess');

module.exports = {
    name: 'dashlist',
    aliases: ['dashboardlist', 'dashconections', 'dashacessos'],
    category: 'admin',
    description: 'Lista as pessoas (IP/UA/data) que conectaram no dashboard em arquivo .txt',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '📡', lastBotResponse, GLOBAL_COOLDOWN);

        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const stamp = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fileName = `dashboard_${stamp.getFullYear()}${pad(stamp.getMonth()+1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.txt`;
        const filePath = path.join(tempDir, fileName);

        const { byClient, totalRequests } = parseAccessLog();
        const body = buildReport({ byClient, totalRequests });
        fs.writeFileSync(filePath, body + '\n', 'utf8');
        const sizeKb = Math.max(1, Math.round(fs.statSync(filePath).size / 1024));

        const caption = byClient.length
            ? `📡 *Conexões no Dashboard*\n👥 *Clientes únicos:* ${byClient.length}\n📈 *Requisições:* ${totalRequests}\n💾 *Tamanho:* ${sizeKb} KB`
            : `📡 *Conexões no Dashboard*\n⚠️ Nenhuma conexão registrada ainda.`;

        try {
            await sock.sendMessage(from, {
                document: fs.readFileSync(filePath),
                fileName,
                mimetype: 'text/plain',
                caption
            }, { quoted: m });
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (err) {
            await sock.sendMessage(from, { text: `❌ Falha ao enviar lista: ${err.message || err}` }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        } finally {
            try { fs.unlinkSync(filePath); } catch (_) {}
        }

        return currentBotResponse;
    }
};
