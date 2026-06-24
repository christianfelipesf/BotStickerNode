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

        const before = await getGitInfo();
        const pull = await run('git pull');
        if (!pull.ok) {
            await sock.sendMessage(from, { text: `❌ Falha no git pull\n🌿 ${before.branch} • 🔖 ${before.short}\n\n${pull.err || pull.out || 'erro'}` }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const after = await getGitInfo();
        const pulled = before.short !== after.short;
        const beforeLabel = (before.subject || before.short).split('\n')[0].trim();
        const afterLabel = (after.subject || after.short).split('\n')[0].trim();
        const commitLine = pulled
            ? `🔖 \`${before.subject ? beforeLabel : before.short}\` ➜ \`${afterLabel}\``
            : `🔖 \`${afterLabel}\` (sem alteração)`;
        const txt = `✅ Atualizado e reiniciando!\n🌿 ${after.branch}\n${commitLine}`;
        await sock.sendMessage(from, { text: txt }, { quoted: m });
        await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);

        setTimeout(() => {
            try { exec('pm2 restart all', { windowsHide: true, detached: true }, () => {}); }
            catch (e) { console.error('⚠️ [updateres] pm2 restart falhou:', e.message); }
        }, 500);

        return lastBotResponse;
    }
};