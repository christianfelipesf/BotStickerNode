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
    description: 'Atualiza o bot via git pull (use "all" para sobrescrever alterações locais)',
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

        // Reação imediata: o bot entendeu o comando e vai executar
        lastBotResponse = await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
        // Emoji da etapa em andamento: baixando atualizações
        lastBotResponse = await react(sock, m, '⬇️', lastBotResponse, GLOBAL_COOLDOWN);

        const before = await getGitInfo();
        let r;
        if (allMode) {
            const fetchR = await run('git fetch --all --prune');
            const resetR = await run(`git reset --hard origin/${before.branch}`);
            const cleanR = await run('git clean -fdx');
            r = (fetchR.ok && resetR.ok)
                ? { ok: true, out: [fetchR.out, resetR.out, cleanR.out].filter(Boolean).join('\n'), err: null }
                : { ok: false, out: resetR.out || fetchR.out, err: resetR.err || fetchR.err || cleanR.err };
        } else {
            r = await run('git pull');
        }
        const ok = r.ok;
        const after = ok ? await getGitInfo() : before;
        const pulled = ok && before.short !== after.short;
        const beforeLabel = (before.subject || before.short).split('\n')[0].trim();
        const afterLabel = (after.subject || after.short).split('\n')[0].trim();
        const commitLine = pulled
            ? `🔖 \`${before.subject ? beforeLabel : before.short}\` ➜ \`${afterLabel}\``
            : `🔖 \`${afterLabel}\` (sem alteração)`;
        const head = allMode ? '♻️ Atualizado, reiniciando!' : '✅ Atualizado!';
        let txt = ok
            ? `${head}\n🌿 ${after.branch}\n${commitLine}`
            : `❌ Falha no git ${allMode ? 'fetch/reset' : 'pull'}\n🌿 ${before.branch} • 🔖 ${before.short}\n\n${r.err || r.out || 'erro'}`;

        if (ok && allMode) {
            try {
                exec('pm2 restart all', { windowsHide: true, detached: true }, () => {});
                txt += '\n🔁 Reiniciando via pm2...';
            } catch (e) {
                txt += `\n⚠️ pm2 restart falhou: ${e?.message || e}`;
                console.error('[update] pm2 restart falhou:', e?.message || e);
            }
        }

        await sock.sendMessage(from, { text: txt }, { quoted: m });
        return await react(sock, m, ok ? '✅' : '❌', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
