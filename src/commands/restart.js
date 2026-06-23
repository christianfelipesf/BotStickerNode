const { exec } = require('child_process');

function isOwner(sock, m, utils) {
    try {
        const meId = utils.normalizeJid(sock.user.id);
        const sender = m.key?.participant || m.sender || (m.key?.fromMe ? sock.user.id : '');
        const senderNorm = utils.normalizeJid(sender);
        return m.key?.fromMe === true || senderNorm === meId;
    } catch (_) { return false; }
}

function run(cmd, cwd) {
    return new Promise((resolve) => {
        try {
            exec(cmd, { cwd, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
                resolve({
                    ok: !err,
                    stdout: String(stdout || '').trim(),
                    stderr: String(stderr || '').trim(),
                    err: err ? (err.message || String(err)) : null
                });
            });
        } catch (e) {
            resolve({ ok: false, stdout: '', stderr: '', err: e?.message || String(e) });
        }
    });
}

async function getGitInfo() {
    const branch = (await run('git rev-parse --abbrev-ref HEAD', process.cwd())).stdout || '?';
    const short = (await run('git rev-parse --short HEAD', process.cwd())).stdout || '?';
    const full = (await run('git rev-parse HEAD', process.cwd())).stdout || '?';
    const status = (await run('git status --porcelain', process.cwd())).stdout || '';
    const dirty = status.trim().length > 0;
    const dirtyShort = dirty ? status.split(/\r?\n/).slice(0, 5).join('\n') : '';
    return { branch, short, full, dirty, dirtyShort };
}

function formatVersion({ branch, short, full, dirty, dirtyShort }) {
    const lines = [];
    lines.push(`🌿 *Branch:* ${branch}`);
    lines.push(`🔖 *Commit:* \`${short}\``);
    lines.push(`🔗 *Hash:* \`${full}\``);
    if (dirty) {
        lines.push(`⚠️ *Mudanças locais:*`);
        lines.push('```');
        lines.push(dirtyShort);
        lines.push('```');
    } else {
        lines.push(`✅ *Working tree:* limpa`);
    }
    return lines.join('\n');
}

module.exports = {
    name: 'restart',
    aliases: ['reiniciar', 'reboot'],
    category: 'admin',
    description: 'Mostra a versão atual e reinicia o bot via pm2',
    async execute(sock, m, { from, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        if (!isOwner(sock, m, utils)) {
            await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }
        await react(sock, m, '🔄', lastBotResponse, GLOBAL_COOLDOWN);

        const info = await getGitInfo();
        await sock.sendMessage(from, { text: `📌 *Versão atual (antes do restart):*\n\n${formatVersion(info)}` }, { quoted: m });

        await sock.sendMessage(from, { text: '🔄 Reiniciando o bot via pm2...' }, { quoted: m });
        const r = await run('pm2 restart all', process.cwd());
        if (!r.ok) {
            await sock.sendMessage(from, { text: `❌ Falha ao reiniciar: ${r.err || r.stderr || 'erro desconhecido'}` }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }
        return await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
    }
};