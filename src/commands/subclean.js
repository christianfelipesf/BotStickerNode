const fs = require('fs');
const path = require('path');
const subSessions = require('../services/subSessions');

module.exports = {
    name: 'subclean',
    aliases: ['subreset', 'subfix', 'cleansub'],
    category: 'admin',
    description: 'Limpa a sub-sessão salva no disco (resolve rate-limit do WhatsApp)',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '🧹', lastBotResponse, GLOBAL_COOLDOWN);

        const removed = [];

        const crypto = require('crypto');
        const ownerHash = crypto.createHash('sha1').update(sender).digest('hex').slice(0, 16);
        const subDir = path.join(process.cwd(), 'session', 'subs');
        const targetDirs = [
            path.join(subDir, ownerHash),
            path.join(subDir, ownerHash + '_pair_test'),
            path.join(subDir, ownerHash + '_pair_pair')
        ];

        if (fs.existsSync(subDir)) {
            try {
                const all = fs.readdirSync(subDir);
                for (const n of all) {
                    if (n === ownerHash || n.startsWith(ownerHash + '_pair_') || n.startsWith(ownerHash + '_pair')) {
                        targetDirs.push(path.join(subDir, n));
                    }
                }
            } catch (_) {}
        }

        for (const d of targetDirs) {
            try {
                if (fs.existsSync(d)) {
                    fs.rmSync(d, { recursive: true, force: true });
                    removed.push(path.basename(d));
                }
            } catch (_) {}
        }

        try { await subSessions.logout(sender); } catch (_) {}

        await sock.sendMessage(from, {
            text: `🧹 *Sub-sessão limpa!*\n\n` +
                `📂 Removidos ${removed.length} diretório(s):\n${removed.length ? removed.map(r => `  • \`${r}\``).join('\n') : '  _(nenhum)_'}\n\n` +
                `✅ Agora você pode usar *!login* (QR) ou *!login <número>* (código) do zero.\n\n` +
                `💡 *Quando usar:*\n` +
                `• Quando o WhatsApp dá 401 / "Connection Failure"\n` +
                `• Quando o QR/pairing fica em loop\n` +
                `• Após rate-limit do WhatsApp (~30 min)`
        }, { quoted: m });

        currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        return currentBotResponse;
    }
};
