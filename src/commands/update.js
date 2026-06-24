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
    const [branch, short, subject] = await Promise.all([
        run('git rev-parse --abbrev-ref HEAD'),
        run('git rev-parse --short HEAD'),
        run('git log -1 --pretty=%s')
    ]);
    return {
        branch: branch.out || '?',
        short: short.out || '?',
        subject: subject.out || ''
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

        const before = await getGitInfo();
        const r = await run('git pull');
        const ok = r.ok;
        const after = ok ? await getGitInfo() : before;
        const pulled = ok && before.short !== after.short;
        const beforeLabel = (before.subject || before.short).split('\n')[0].trim();
        const afterLabel = (after.subject || after.short).split('\n')[0].trim();
        const commitLine = pulled
            ? `🔖 \`${before.subject ? beforeLabel : before.short}\` ➜ \`${afterLabel}\``
            : `🔖 \`${afterLabel}\` (sem alteração)`;
        const txt = ok
            ? `✅ Atualizado!\n🌿 ${after.branch}\n${commitLine}`
            : `❌ Falha no git pull\n🌿 ${before.branch} • 🔖 ${before.short}\n\n${r.err || r.out || 'erro'}`;
        await sock.sendMessage(from, { text: txt }, { quoted: m });
        return await react(sock, m, ok ? '✅' : '❌', lastBotResponse, GLOBAL_COOLDOWN);
    }
};