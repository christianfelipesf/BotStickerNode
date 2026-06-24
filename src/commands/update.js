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
    aliases: ['upgrade', 'atualizar', 'atualiza', 'pull', 'updateall'],
    category: 'admin',
    description: 'Roda git pull e reinicia o bot via pm2',
    async execute(sock, m, { from, utils, lastBotResponse, GLOBAL_COOLDOWN, fullArgsText, commandName, args }) {
        const { react } = utils;
        if (!isOwner(sock, m, utils)) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        const argsText = String(fullArgsText || '').trim().toLowerCase();
        const firstArg = String((Array.isArray(args) && args[0]) || '').toLowerCase();
        const allMode = commandName === 'updateall'
            || argsText === 'all'
            || argsText === '--all'
            || argsText.startsWith('all ')
            || argsText.startsWith('--all ')
            || firstArg === 'all'
            || firstArg === '--all';

        lastBotResponse = await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
        lastBotResponse = await react(sock, m, '⬇️', lastBotResponse, GLOBAL_COOLDOWN);

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
        const head = '✅ Atualizado!';
        let txt = ok
            ? `${head}\n🌿 ${after.branch}\n${commitLine}\n🔁 Reiniciando via pm2...`
            : `❌ Falha no git pull\n🌿 ${before.branch} • 🔖 ${before.short}\n\n${r.err || r.out || 'erro'}`;

        if (ok) {
            try {
                exec('pm2 restart all', { windowsHide: true, detached: true }, () => {});
            } catch (e) {
                txt += `\n⚠️ pm2 restart falhou: ${e?.message || e}`;
                console.error('[update] pm2 restart falhou:', e?.message || e);
            }
        }

        await sock.sendMessage(from, { text: txt }, { quoted: m });
        return await react(sock, m, ok ? '✅' : '❌', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
