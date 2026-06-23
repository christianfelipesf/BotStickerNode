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
    name: 'update',
    aliases: ['atualizar', 'pull'],
    category: 'admin',
    description: 'Atualiza o bot via git pull',
    async execute(sock, m, { from, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        if (!isOwner(sock, m, utils)) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }
        await react(sock, m, '⬇️', lastBotResponse, GLOBAL_COOLDOWN);

        const info = await getGitInfo();
        const r = await run('git pull');
        const ok = r.ok;
        const txt = ok
            ? `✅ Atualizado!\n🌿 ${info.branch} • 🔖 ${info.short}\n\n${r.out || 'Sem alterações.'}`
            : `❌ Falha no git pull\n🌿 ${info.branch} • 🔖 ${info.short}\n\n${r.err || r.out || 'erro'}`;
        await sock.sendMessage(from, { text: txt }, { quoted: m });
        return await react(sock, m, ok ? '✅' : '❌', lastBotResponse, GLOBAL_COOLDOWN);
    }
};