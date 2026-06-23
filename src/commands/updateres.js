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
    name: 'updateres',
    aliases: ['resupdate', 'update-restart', 'atualizar-reiniciar', 'updateall', 'update-all', 'atualizar-tudo'],
    category: 'admin',
    description: 'Atualiza (git pull) e reinicia o bot (pm2 restart)',
    async execute(sock, m, { from, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        if (!isOwner(sock, m, utils)) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }
        await react(sock, m, '⬇️', lastBotResponse, GLOBAL_COOLDOWN);

        const info = await getGitInfo();
        const pull = await run('git pull');
        if (!pull.ok) {
            await sock.sendMessage(from, { text: `❌ Falha no git pull\n🌿 ${info.branch} • 🔖 ${info.short}\n\n${pull.err || pull.out || 'erro'}` }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        await run('pm2 restart all');
        const txt = `✅ Atualizado e reiniciado!\n🌿 ${info.branch} • 🔖 ${info.short}\n\n${pull.out || 'Sem alterações.'}`;
        await sock.sendMessage(from, { text: txt }, { quoted: m });
        return await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
    }
};