const { exec } = require('child_process');

const run = (cmd, timeoutMs = 5 * 60 * 1000) => new Promise(resolve => {
    try {
        exec(cmd, { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024, windowsHide: true, timeout: timeoutMs },
            (err, stdout, stderr) => resolve({ ok: !err, out: (stdout || '').trim(), err: (stderr || '').trim() || err?.message || null }));
    } catch (e) { resolve({ ok: false, out: '', err: e?.message || String(e) }); }
});

const locks = new Map();
const lock = (k, ttlMs = 90 * 1000) => {
    const cur = locks.get(k);
    if (cur && cur.until > Date.now()) return false;
    locks.set(k, { until: Date.now() + ttlMs });
    return true;
};
const unlock = (k, delayMs = 0) => { if (delayMs) setTimeout(() => locks.delete(k), delayMs); else locks.delete(k); };

const handlers = {
    // GET-only: verifica se há atualizações disponíveis (sem modificar nada)
    'check-update': async () => {
        const fetch = await run('git fetch', 60 * 1000);
        if (!fetch.ok) {
            return { behind: 0, error: fetch.err || 'git fetch falhou' };
        }
        const count = await run('git rev-list HEAD..@{upstream} --count', 30 * 1000);
        const behind = parseInt(count.out || '0', 10);
        let summary = '';
        if (behind > 0) {
            const log = await run(`git log --oneline -${Math.min(behind, 5)} HEAD..@{upstream}`, 30 * 1000);
            summary = log.out || '';
        }
        return { behind, summary: summary.split('\n').filter(Boolean) };
    },
    update: async () => {
        const before = await run('git rev-parse --short HEAD', 30 * 1000);
        const pull = await run('git pull', 3 * 60 * 1000);
        const after = pull.ok ? await run('git rev-parse --short HEAD', 30 * 1000) : { out: '' };
        const changed = pull.ok && before.out !== after.out;
        let pkgChanged = false;
        if (changed) {
            const diff = await run(`git diff --name-only ${before.out}..${after.out}`, 30 * 1000);
            const files = (diff.out || '').split('\n').map(f => f.trim()).filter(Boolean);
            pkgChanged = files.some(f => f === 'package.json' || f === 'package-lock.json');
        }
        return { command: 'git pull', before: before.out || '?', after: after.out || before.out || '?', changed, pkgChanged, ok: pull.ok, out: pull.out, err: pull.err };
    },
    restart: async () => {
        const r = await run('pm2 restart all', 60 * 1000);
        return { command: 'pm2 restart all', ok: r.ok, out: r.out, err: r.err };
    },
    install: async () => {
        const r = await run('npm install --no-audit --no-fund', 10 * 60 * 1000);
        return { command: 'npm install', ok: r.ok, out: r.out, err: r.err };
    }
};

module.exports = function mountMgmt(app, { isAdmin, json }) {
    const actionKeys = Object.keys(handlers);

    // check-update é GET (não modifica nada), os demais são POST
    app.get('/api/admin/check-update', async (req, res) => {
        if (!isAdmin(req)) return json(res, false, { error: 'Não autenticado' }, 401);
        try {
            const data = await handlers['check-update']();
            return json(res, true, data);
        } catch (e) {
            return json(res, false, { error: e.message }, 500);
        }
    });

    for (const action of actionKeys) {
        if (action === 'check-update') continue;
        app.post('/api/admin/' + action, async (req, res) => {
            if (!isAdmin(req)) return json(res, false, { error: 'Não autenticado' }, 401);
            if (!lock(action)) return json(res, false, { error: 'Já existe ' + action + ' em andamento. Aguarde.' }, 429);
            try {
                const data = await handlers[action]();
                return json(res, true, data);
            } finally {
                unlock(action, action === 'update' ? 0 : 5000);
            }
        });
    }
};
