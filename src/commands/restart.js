const { exec } = require('child_process');

function isOwner(sock, m, utils) {
    try {
        const meId = utils.normalizeJid(sock.user.id);
        const sender = m.key?.participant || m.sender || (m.key?.fromMe ? sock.user.id : '');
        const senderNorm = utils.normalizeJid(sender);
        return m.key?.fromMe === true || senderNorm === meId;
    } catch (_) { return false; }
}

function run(cmd) {
    return new Promise((resolve) => {
        try {
            exec(cmd, { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
                resolve({ ok: !err, out: (stdout || stderr || '').trim(), err: err?.message || null });
            });
        } catch (e) { resolve({ ok: false, out: '', err: e?.message || String(e) }); }
    });
}

async function getGitInfo() {
    const [branch, short, status] = await Promise.all([
        run('git rev-parse --abbrev-ref HEAD'),
        run('git rev-parse --short HEAD'),
        run('git status --porcelain')
    ]);
    return {
        branch: branch.out || '?',
        short: short.out || '?',
        dirty: status.out.trim().length > 0
    };
}

module.exports = {
    name: 'restart',
    aliases: ['reiniciar', 'reboot'],
    category: 'admin',
    description: 'Reinicia o bot via pm2',
    async execute(sock, m, { from, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        if (!isOwner(sock, m, utils)) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }
        // Reação imediata: o bot entendeu o comando e vai executar
        lastBotResponse = await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
        // Emoji da etapa em andamento: reiniciando
        lastBotResponse = await react(sock, m, '🔄', lastBotResponse, GLOBAL_COOLDOWN);
        const info = await getGitInfo();
        const r = await run('pm2 restart all');
        const ok = r.ok;
        const txt = ok
            ? `✅ Reiniciado!\n🌿 ${info.branch} • 🔖 ${info.short}`
            : `❌ Falha no pm2 restart\n\n${r.err || r.out || 'erro'}`;
        await sock.sendMessage(from, { text: txt }, { quoted: m });
        return await react(sock, m, ok ? '✅' : '❌', lastBotResponse, GLOBAL_COOLDOWN);
    }
};