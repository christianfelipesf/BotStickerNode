const subSessions = require('../services/subSessions');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'subdebug',
    aliases: ['debugsub'],
    category: 'admin',
    description: 'Diagnóstico da sub-sessão (estado, credenciais, tentativas)',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '🔍', lastBotResponse, GLOBAL_COOLDOWN);

        const session = subSessions.getSession(sender);
        const all = subSessions.listSessions();
        const subDir = path.join(process.cwd(), 'session', 'subs');
        let credsExists = false, credList = null;
        try {
            const crypto = require('crypto');
            const hash = crypto.createHash('sha1').update(sender).digest('hex').slice(0, 16);
            const sessDir = path.join(subDir, hash);
            credsExists = fs.existsSync(path.join(sessDir, 'creds.json'));
            if (fs.existsSync(sessDir)) credList = fs.readdirSync(sessDir);
        } catch (_) {}

        const lines = [
            '🔍 *Diagnóstico da Sub-sessão*',
            '',
            `👤 Owner: \`${sender.split('@')[0]}\``,
            `📂 Sessão no map: ${session ? '✓' : '✗'}`,
        ];
        if (session) {
            const sinceLast = session.lastQrAt ? Math.round((Date.now() - session.lastQrAt) / 1000) : '?';
            lines.push(`   • connected: ${session.connected}`);
            lines.push(`   • connecting: ${session.connecting}`);
            lines.push(`   • qrAttempts: ${session.qrAttempts}`);
            lines.push(`   • seconds since last QR: ${sinceLast}`);
            lines.push(`   • prefix: ${session.prefix}`);
            lines.push(`   • phone: ${session.phoneNumber || '?'}`);
            lines.push(`   • has sock: ${!!session.sock}`);
        }
        lines.push('');
        lines.push(`📋 Total de sub-sessões ativas: ${all.length}`);
        for (const s of all) {
            lines.push(`   • \`${s.ownerJid.split('@')[0]}\` ${s.connected ? '🟢' : '🟡'} ${s.phoneNumber || '?'} prefix=\`${s.prefix}\``);
        }
        lines.push('');
        lines.push(`💾 Creds em disco: ${credsExists ? '✓' : '✗'}`);
        if (credList) {
            lines.push(`   arquivos: ${credList.slice(0, 10).join(', ')}${credList.length > 10 ? '…' : ''}`);
        }

        try {
            const cfg = require('../database/utils').readConfig();
            lines.push('');
            lines.push(`⚙️ subSessionsGroups: ${typeof cfg.subSessionsGroups === 'boolean' ? cfg.subSessionsGroups : '(default true)'}`);
        } catch (_) {}

        await sock.sendMessage(from, { text: lines.join('\n') }, { quoted: m });
        currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        return currentBotResponse;
    }
};
