const fs = require('fs');
const path = require('path');
const terminalLog = require('../services/terminalLog');

module.exports = {
    name: 'log',
    aliases: ['logs', 'logsterminal', 'terminallog'],
    category: 'admin',
    description: 'Envia os últimos 15 logs do terminal como arquivo .txt',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, {
                text: '❌ Apenas o dono do bot pode usar este comando.'
            }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '📜', lastBotResponse, GLOBAL_COOLDOWN);

        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const stamp = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fileName = `logs_${stamp.getFullYear()}${pad(stamp.getMonth()+1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.txt`;
        const filePath = path.join(tempDir, fileName);

        const lines = terminalLog.getLast(15);
        const header = [
            `# BotStickerNode — últimos ${lines.length} logs do terminal`,
            `# Gerado em: ${stamp.toLocaleString('pt-BR')}`,
            `# Buffer: ${terminalLog.getBufferSize()}/${terminalLog.getRingMax()} (mais recentes)`,
            `# Arquivo diário: ${path.join(terminalLog.getLogsDir(), `terminal_${stamp.toISOString().slice(0,10)}.log`)}`,
            ''
        ].join('\n');

        const body = lines.length
            ? lines.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.text}`).join('\n')
            : '(buffer vazio — nenhum log capturado ainda)';

        fs.writeFileSync(filePath, header + body + '\n', 'utf8');
        const sizeKb = Math.max(1, Math.round(fs.statSync(filePath).size / 1024));

        const caption = lines.length
            ? `📜 *Últimos ${lines.length} logs do terminal*\n🗂️ *Buffer:* ${terminalLog.getBufferSize()}/${terminalLog.getRingMax()}\n💾 *Tamanho:* ${sizeKb} KB`
            : `📜 *Logs do terminal*\n⚠️ Buffer vazio ainda (nenhum console.* capturado desde o boot).`;

        try {
            await sock.sendMessage(from, {
                document: fs.readFileSync(filePath),
                fileName,
                mimetype: 'text/plain',
                caption
            }, { quoted: m });

            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (err) {
            await sock.sendMessage(from, {
                text: `❌ Falha ao enviar logs: ${err.message || err}`
            }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        } finally {
            try { fs.unlinkSync(filePath); } catch (_) {}
        }

        return currentBotResponse;
    }
};
