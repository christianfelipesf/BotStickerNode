const fs = require('fs');
const path = require('path');
const subSessions = require('../services/subSessions');

module.exports = {
    name: 'subcleanall',
    aliases: ['subcleanforce', 'cleansubs'],
    category: 'admin',
    description: 'Limpa TODAS as sub-sessões salvas (admin do bot)',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '🧹', lastBotResponse, GLOBAL_COOLDOWN);

        const subDir = path.join(process.cwd(), 'session', 'subs');
        let removed = 0;
        const list = subSessions.listSessions();

        for (const s of list) {
            try { await subSessions.logout(s.ownerJid); } catch (_) {}
        }

        try {
            if (fs.existsSync(subDir)) {
                const all = fs.readdirSync(subDir);
                for (const d of all) {
                    try {
                        const full = path.join(subDir, d);
                        const stat = fs.statSync(full);
                        if (stat.isDirectory()) {
                            fs.rmSync(full, { recursive: true, force: true });
                            removed++;
                        }
                    } catch (_) {}
                }
            }
        } catch (_) {}

        await sock.sendMessage(from, {
            text: `🧹 *Todas sub-sessões foram limpas!*\n\n` +
                `📂 Removidos ${removed} diretório(s)\n` +
                `🚪 Encerradas ${list.length} sessão(ões) em memória\n\n` +
                `✅ Pronto. Qualquer pessoa pode usar *!login* agora.`
        }, { quoted: m });

        currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        return currentBotResponse;
    }
};
