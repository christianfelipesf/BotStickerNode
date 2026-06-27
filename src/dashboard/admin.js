const $ = id => document.getElementById(id);
const toast = (msg, type = 'ok') => {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast show ' + type;
    clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast ' + type, 2200);
};
const api = (path, opts = {}) => fetch(path, {
    method: opts.method || 'GET', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
}).then(async r => ({ ok: r.ok, status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }));

let cfg = {}, orig = {}, dirty = new Set(), user = '', editKey = null;

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function inferType(v) { if (v === null) return 'null'; if (Array.isArray(v)) return 'array'; return typeof v; }
function preview(v) {
    if (typeof v === 'boolean') return v ? '✅ ON' : '⛔ OFF';
    if (typeof v === 'string') return v.length > 30 ? v.slice(0, 30) + '…' : v;
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) return `[${v.length} itens]`;
    if (v === null) return 'null';
    if (typeof v === 'object') return '{…}';
    return String(v);
}

function renderCard(k, v) {
    const t = inferType(v);
    const isApiKey = k === 'openrouterApiKey';
    const card = document.createElement('div');
    card.className = 'card' + ((dirty.has(k) || isApiKey) ? '' : '');
    card.dataset.key = k;

    const r1 = document.createElement('div'); r1.className = 'row1';
    const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = k;
    const tp = document.createElement('div'); tp.className = 'type'; tp.textContent = isApiKey ? 'senha' : (t === 'object' ? 'obj' : t);
    r1.append(nm, tp); card.appendChild(r1);

    const doc = window.Dashboard && window.Dashboard.configDocs ? window.Dashboard.configDocs[k] : null;
    if (doc) {
        const desc = document.createElement('div');
        desc.style.cssText = 'font-size:11px;color:#9aa6b2;margin:6px 0 4px;line-height:1.4';
        desc.textContent = doc;
        card.appendChild(desc);
    }

    if (isApiKey) {
        const inp = document.createElement('input');
        inp.type = 'password';
        inp.placeholder = 'sk-or-v1-...';
        inp.value = v === '••••••••' ? '' : v;
        inp.style.width = '100%;background:#0e1116;border:1px solid #30363d;border-radius:5px;padding:6px 9px;color:#e6edf3;font-size:12px;font-family:ui-monospace,monospace';
        inp.addEventListener('input', () => edit(k, inp.value));
        card.appendChild(inp);
        const status = document.createElement('div');
        status.style.cssText = 'font-size:11px;margin-top:4px;font-family:ui-monospace,monospace';
        status.textContent = v === '••••••••' ? '✅ configurada' : '✗ não definida';
        status.style.color = v === '••••••••' ? '#3fb950' : '#f85149';
        card.appendChild(status);
        const r2 = document.createElement('div'); r2.className = 'row2';
        r2.style.justifyContent = 'flex-end';
        const sb = document.createElement('button'); sb.className = 'save'; sb.textContent = '💾';
        sb.onclick = async () => {
            const val = cfg.openrouterApiKey || '';
            if (!val) { toast('Digite a chave', 'err'); return; }
            const r = await api('/api/admin/env-key', { method: 'POST', body: { key: val } });
            if (!r.ok) { toast(r.data?.error || 'Erro', 'err'); return; }
            toast('Chave salva no .env ✓', 'ok');
            load();
        };
        r2.appendChild(sb);
        const rb = document.createElement('button'); rb.className = 'save'; rb.textContent = '🗑️';
        rb.style.cssText = 'background:#1f2530;color:#f85149;border:1px solid #f85149;border-radius:5px;padding:5px 9px;font-size:11px;cursor:pointer';
        rb.onclick = async () => {
            const r = await api('/api/admin/env-key', { method: 'POST', body: { key: '' } });
            if (!r.ok) { toast(r.data?.error || 'Erro', 'err'); return; }
            toast('Chave removida', 'ok');
            load();
        };
        r2.appendChild(rb);
        card.appendChild(r2);
        return card;
    }

    if (t === 'boolean') {
        const tg = document.createElement('div');
        tg.className = 'toggle' + (v ? ' on' : '');
        tg.onclick = () => { tg.classList.toggle('on'); edit(k, !current(k)); rerender(); };
        card.appendChild(tg);
    } else if (t === 'array' || t === 'object') {
        const pv = document.createElement('div'); pv.className = 'preview'; pv.textContent = preview(v); pv.title = JSON.stringify(v);
        const eb = document.createElement('button'); eb.textContent = '✏️ Editar'; eb.style.cssText = 'margin-top:8px;width:100%;background:#1f2530;color:#e6edf3;border:1px solid #30363d;border-radius:5px;padding:5px;font-size:11px;cursor:pointer';
        eb.onclick = () => openEdit(k, v, t);
        card.append(pv, eb);
    } else {
        const inp = document.createElement('input');
        inp.type = t === 'number' ? 'number' : 'text';
        inp.step = 'any';
        inp.value = v == null ? '' : v;
        inp.addEventListener('input', () => {
            let nv = inp.value;
            if (t === 'number') { const n = parseFloat(nv); if (isNaN(n)) { inp.style.borderColor = '#f85149'; return; } inp.style.borderColor = ''; nv = n; }
            edit(k, nv);
        });
        card.appendChild(inp);
    }

    const r2 = document.createElement('div'); r2.className = 'row2';
    if (t !== 'boolean') {
        const pv = document.createElement('div'); pv.className = 'preview'; pv.textContent = preview(v); pv.title = JSON.stringify(v);
        r2.appendChild(pv);
    } else r2.style.justifyContent = 'flex-end';
    const sb = document.createElement('button'); sb.className = 'save'; sb.textContent = '💾';
    sb.onclick = () => saveOne(k);
    r2.appendChild(sb); card.appendChild(r2);
    return card;
}

const current = k => cfg[k];
const edit = (k, v) => { if (!eq(v, orig[k])) dirty.add(k); else dirty.delete(k); cfg[k] = v; updateDirty(); };
function updateDirty() {
    document.querySelectorAll('.card').forEach(el => el.classList.toggle('dirty', dirty.has(el.dataset.key)));
    $('btnSaveAll').textContent = '💾 Salvar (' + dirty.size + ')';
}
function rerender() {
    const filter = $('searchInput').value.toLowerCase().trim();
    const items = Object.entries(cfg).filter(([k]) => !filter || k.toLowerCase().includes(filter)).sort((a, b) => a[0].localeCompare(b[0]));
    const g = $('grid');
    g.innerHTML = items.length === 0 ? '<div class="empty">Nenhuma chave.</div>' : '';
    for (const [k, v] of items) g.appendChild(renderCard(k, v));
    updateDirty();
}

function updateDashToggle() {
    const on = cfg.dashboardChatBlocked !== true;
    const btn = $('btnDashToggle');
    btn.textContent = on ? '💬 Ativo' : '💬 Bloqueado';
    btn.className = 'mgmt-btn' + (on ? '' : ' err');
    btn.title = on ? 'Clique para bloquear o chat do dashboard' : 'Clique para liberar o chat do dashboard';
    $('dashStatus').textContent = on ? 'chat liberado' : 'chat bloqueado';
    $('dashStatus').className = 'mgmt-status' + (on ? ' ok' : ' err');
}

async function load() {
    const r = await api('/api/admin/config');
    if (!r.ok) { if (r.status === 401) showLogin(); return; }
    cfg = clone(r.data.config); orig = clone(r.data.config); dirty.clear();
    $('userPill').textContent = '👤 ' + user;
    $('infoLine').textContent = `${r.data.botName || 'Bot'} • v${r.data.version || '?'} • ${r.data.platform || '?'} • restart #${r.data.restarts ?? '?'}`;
    showMain(); rerender(); updateDashToggle();
}
async function saveOne(k) {
    const r = await api('/api/admin/config', { method: 'PUT', body: { updates: { [k]: cfg[k] } } });
    if (!r.ok) { toast('Erro ao salvar', 'err'); return; }
    orig[k] = clone(cfg[k]); dirty.delete(k); updateDirty(); toast(k + ' salvo ✓', 'ok');
}
async function saveAll() {
    if (dirty.size === 0) return;
    const updates = {}; for (const k of dirty) updates[k] = cfg[k];
    const r = await api('/api/admin/config', { method: 'PUT', body: { updates } });
    if (!r.ok) { toast('Erro', 'err'); return; }
    for (const k of dirty) orig[k] = clone(cfg[k]);
    dirty.clear(); updateDirty(); toast(Object.keys(updates).length + ' salvas ✓', 'ok');
}

const showLogin = () => { $('loginCard').classList.remove('hidden'); $('mainApp').classList.add('hidden'); };
const showMain = () => { $('loginCard').classList.add('hidden'); $('mainApp').classList.remove('hidden'); };

$('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const u = $('loginUser').value.trim(), p = $('loginPass').value;
    const r = await api('/api/admin/login', { method: 'POST', body: { username: u, password: p } });
    if (!r.ok) { $('loginError').textContent = r.data?.error || 'Erro'; return; }
    user = u; await load();
});
$('btnLogout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' });
    user = ''; $('userPill').textContent = '—'; showLogin(); $('loginUser').value = ''; $('loginPass').value = '';
});
$('btnReload').addEventListener('click', load);
$('btnSaveAll').addEventListener('click', saveAll);
$('btnDiscard').addEventListener('click', () => { cfg = clone(orig); dirty.clear(); rerender(); toast('Descartado'); });
$('searchInput').addEventListener('input', rerender);

const goDashboard = () => { window.location.href = '/'; };
$('backToDash').addEventListener('click', goDashboard);
$('userPill').addEventListener('click', goDashboard);

$('btnCred').addEventListener('click', () => {
    $('credCurUser').value = user;
    $('credNewUser').value = user; $('credNewPass').value = ''; $('credConfirm').value = ''; $('credErr').textContent = '';
    $('credModal').classList.add('show');
});
$('credCancel').addEventListener('click', () => $('credModal').classList.remove('show'));
$('credSave').addEventListener('click', async () => {
    const u = $('credNewUser').value.trim(), p = $('credNewPass').value, c = $('credConfirm').value;
    if (p !== c) { $('credErr').textContent = 'Senhas não conferem'; return; }
    const r = await api('/api/admin/credentials', { method: 'POST', body: { username: u, password: p } });
    if (!r.ok) { $('credErr').textContent = r.data?.error || 'Erro'; return; }
    toast('Atualizado ✓', 'ok'); $('credModal').classList.remove('show'); user = u; $('userPill').textContent = '👤 ' + u;
});

function openEdit(k, v, t) {
    editKey = k; $('editTitle').textContent = 'Editar ' + k;
    $('editLbl').textContent = `Tipo: ${t}. Use JSON válido.`;
    $('editValue').value = (t === 'array' || t === 'object') ? JSON.stringify(v, null, 2) : String(v);
    $('editErr').textContent = ''; $('editModal').classList.add('show');
    setTimeout(() => $('editValue').focus(), 50);
}
$('editCancel').addEventListener('click', () => { $('editModal').classList.remove('show'); editKey = null; });
$('editSave').addEventListener('click', () => {
    if (!editKey) return;
    const t = inferType(cfg[editKey]);
    try {
        const v = (t === 'array' || t === 'object') ? JSON.parse($('editValue').value)
            : t === 'number' ? parseFloat($('editValue').value)
            : $('editValue').value;
        cfg[editKey] = v; edit(editKey, v);
        $('editModal').classList.remove('show'); editKey = null; rerender(); toast('Editado — clique 💾', 'ok');
    } catch (e) { $('editErr').textContent = 'JSON inválido: ' + e.message; }
});

// === Gestão: git pull / npm install / pm2 restart ===
const MGMT = {
    update:  { label: 'Atualizar (git pull)', cmd: 'git pull',       desc: 'Baixa as últimas alterações do repositório. NÃO reinicia o bot.' },
    install: { label: 'Instalar dependências', cmd: 'npm install',    desc: 'Instala/atualiza pacotes do package.json. Pode levar alguns minutos.' },
    restart: { label: 'Reiniciar bot',        cmd: 'pm2 restart all', desc: 'Reinicia o bot via pm2. A sessão do dashboard será reconectada.' },
    stop:    { label: 'Parar bot',            cmd: 'pm2 stop all',    desc: 'Para o bot via pm2. O dashboard será desligado.' },
    'delete-session': { label: 'Apagar sessão', cmd: 'rm -rf session', desc: 'Apaga a pasta session/ para forçar um novo QR Code na próxima conexão.' }
};
const cooldown = new Map();
const COOLDOWN_MS = 8 * 1000;
let busy = false;

let _pendingPkgUpdate = false;

const setStatus = (t, c) => { const el = $('mgmtStatus'); if (!el) return; el.textContent = t; el.className = 'mgmt-status' + (c ? ' ' + c : ''); };
const setBtn = (btn, kind) => {
    if (!btn) return;
    btn.classList.remove('busy', 'ok', 'err');
    if (!btn.dataset.orig) btn.dataset.orig = btn.innerHTML;
    if (kind === 'busy') { btn.classList.add('busy'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> executando…'; }
    else if (kind === 'ok') { btn.classList.add('ok'); btn.disabled = false; btn.innerHTML = btn.dataset.orig; }
    else if (kind === 'err') { btn.classList.add('err'); btn.disabled = false; btn.innerHTML = btn.dataset.orig; }
    else { btn.disabled = false; btn.innerHTML = btn.dataset.orig; }
};

const ask = (action, extraDesc) => {
    const info = MGMT[action]; if (!info) return;
    if (Date.now() - (cooldown.get(action) || 0) < COOLDOWN_MS) return toast('Aguarde alguns segundos', 'err');
    if (busy) return toast('Outra ação em andamento', 'err');
    $('mgmtTitle').textContent = 'Confirmar: ' + info.label;
    $('mgmtDesc').textContent = extraDesc || info.desc;
    $('mgmtCmd').textContent = '$ ' + info.cmd;
    $('mgmtErr').textContent = '';
    $('mgmtConfirm').dataset.action = action;
    $('mgmtConfirm').textContent = 'Executar';
    $('mgmtConfirm').disabled = $('mgmtCancel').disabled = false;
    $('mgmtModal').classList.add('show');
};
$('mgmtCancel').addEventListener('click', () => $('mgmtModal').classList.remove('show'));

async function checkUpdates() {
    try {
        const r = await api('/api/admin/check-update');
        if (!r.ok) return;
        const d = r.data || {};
        const badge = $('updateBadge');
        if (!badge) return;
        if (d.behind > 0) {
            badge.textContent = d.behind;
            badge.className = 'badge';
            setStatus(d.behind + ' atualização(ões) disponível(is)', 'ok');
        } else {
            badge.className = 'badge hidden';
            setStatus('pronto');
        }
    } catch (_) {}
}

async function doUpdate(btn) {
    setBtn(btn, 'busy'); setStatus('Executando git pull…');
    const r = await api('/api/admin/update', { method: 'POST' });
    const d = r.data || {};
    if (!r.ok) {
        const msg = d.error || ('HTTP ' + r.status);
        setBtn(btn, 'err'); setStatus('✗ ' + msg, 'err'); toast('Falha: ' + msg, 'err');
        return;
    }
    let txt;
    if (d.changed) {
        txt = `atualizado ${d.before} → ${d.after}`;
    } else if (d.hasLocalChanges) {
        txt = `alterações locais impedem o pull. Commit ou stash primeiro.`;
        setBtn(btn, 'err');
        setStatus('✗ ' + txt, 'err');
        toast('git pull: ' + txt, 'err');
        $('updateBadge').className = 'badge hidden';
        return;
    } else if (d.err) {
        txt = `falhou: ${d.err}`;
        setBtn(btn, 'err');
        setStatus('✗ ' + txt, 'err');
        toast('git pull: ' + txt, 'err');
        $('updateBadge').className = 'badge hidden';
        return;
    } else {
        txt = `sem alterações (${d.after || d.before})`;
    }
    setBtn(btn, 'ok'); setStatus('✓ ' + txt, 'ok'); toast('git pull: ' + txt, 'ok');

    // Esconde badge de atualização
    $('updateBadge').className = 'badge hidden';

    if (!d.changed) return;

    // Se package.json mudou, sugere npm install automaticamente
    if (d.pkgChanged) {
        toast('📦 package.json alterado — instale as deps!', 'ok');
        _pendingPkgUpdate = true;
        $('mgmtTitle').textContent = '📦 Dependências alteradas';
        $('mgmtDesc').textContent = 'O package.json foi modificado no pull. Recomenda-se rodar npm install para atualizar as dependências. Deseja executar agora?';
        $('mgmtCmd').textContent = '$ npm install --no-audit --no-fund';
        $('mgmtErr').textContent = '';
        $('mgmtConfirm').dataset.action = 'install';
        $('mgmtConfirm').textContent = 'Instalar';
        $('mgmtConfirm').disabled = $('mgmtCancel').disabled = false;
        $('mgmtModal').classList.add('show');
    } else {
        toast('✅ Código atualizado. Reinicie manualmente quando quiser aplicar.', 'ok');
    }
}

async function doInstall(btn) {
    _pendingPkgUpdate = false;
    setBtn(btn, 'busy'); setStatus('Executando npm install…');
    const r = await api('/api/admin/install', { method: 'POST' });
    const d = r.data || {};
    if (!r.ok) {
        const msg = d.error || ('HTTP ' + r.status);
        setBtn(btn, 'err'); setStatus('✗ ' + msg, 'err'); toast('Falha: ' + msg, 'err');
        return;
    }
    const ok = d.ok !== false;
    setBtn(btn, ok ? 'ok' : 'err');
    setStatus(ok ? '✓ npm install concluído' : '✗ npm install falhou', ok ? 'ok' : 'err');
    toast(ok ? 'npm install ✓' : 'npm install falhou', ok ? 'ok' : 'err');

    if (ok) {
        toast('✅ Dependências instaladas. Reinicie manualmente se necessário.', 'ok');
    }
}

async function doStop(btn) {
    setBtn(btn, 'busy'); setStatus('Executando pm2 stop…');
    const r = await api('/api/admin/stop', { method: 'POST' });
    const d = r.data || {};
    if (!r.ok) {
        const msg = d.error || ('HTTP ' + r.status);
        setBtn(btn, 'err'); setStatus('✗ ' + msg, 'err'); toast('Falha: ' + msg, 'err');
        return;
    }
    setBtn(btn, d.ok ? 'ok' : 'err');
    setStatus(d.ok ? '✓ pm2 stop enviado' : '✗ pm2 stop falhou', d.ok ? 'ok' : 'err');
    toast(d.ok ? 'Parando…' : 'Falhou', d.ok ? 'ok' : 'err');
}

async function doDeleteSession(btn) {
    if (!confirm('⚠️ TEM CERTEZA? Isso vai apagar a sessão atual do WhatsApp.\n\nO bot precisará de um novo QR Code para conectar.\n\nContinuar?')) return;
    setBtn(btn, 'busy'); setStatus('Apagando sessão…');
    const r = await api('/api/admin/delete-session', { method: 'POST' });
    const d = r.data || {};
    if (!r.ok) {
        const msg = d.error || ('HTTP ' + r.status);
        setBtn(btn, 'err'); setStatus('✗ ' + msg, 'err'); toast('Falha: ' + msg, 'err');
        return;
    }
    setBtn(btn, d.ok ? 'ok' : 'err');
    setStatus(d.ok ? '✓ Sessão apagada' : '✗ Falhou', d.ok ? 'ok' : 'err');
    toast(d.ok ? 'Sessão apagada' : 'Falhou', d.ok ? 'ok' : 'err');
}

async function doRestart(btn) {
    setBtn(btn, 'busy'); setStatus('Executando pm2 restart…');
    const r = await api('/api/admin/restart', { method: 'POST' });
    const d = r.data || {};
    if (!r.ok) {
        const msg = d.error || ('HTTP ' + r.status);
        setBtn(btn, 'err'); setStatus('✗ ' + msg, 'err'); toast('Falha: ' + msg, 'err');
        return;
    }
    setBtn(btn, d.ok ? 'ok' : 'err');
    setStatus(d.ok ? '✓ pm2 restart enviado' : '✗ pm2 restart falhou', d.ok ? 'ok' : 'err');
    toast(d.ok ? 'Reiniciando…' : 'Falhou', d.ok ? 'ok' : 'err');
    if (d.ok) setTimeout(() => location.reload(), 3500);
}

$('mgmtConfirm').addEventListener('click', async () => {
    const action = $('mgmtConfirm').dataset.action;
    if (!action) return;
    $('mgmtConfirm').disabled = $('mgmtCancel').disabled = true;
    busy = true; cooldown.set(action, Date.now());
    $('mgmtModal').classList.remove('show');

    const btn = $('btnMgmt' + action[0].toUpperCase() + action.slice(1));

    try {
        if (action === 'update') await doUpdate(btn);
        else if (action === 'install') await doInstall(btn);
        else if (action === 'restart') await doRestart(btn);
        else if (action === 'stop') await doStop(btn);
        else if (action === 'delete-session') await doDeleteSession(btn); // não usado via modal, mas mantido
    } catch (e) {
        setBtn(btn, 'err'); setStatus('✗ ' + (e?.message || 'erro'), 'err'); toast('Erro: ' + (e?.message || 'falha'), 'err');
    } finally {
        busy = false;
        setTimeout(() => {
            setBtn(btn, null);
            if (!_pendingPkgUpdate) checkUpdates();
        }, 4000);
    }
});

document.querySelectorAll('.mgmt-btn[data-mgmt]').forEach(btn => {
    btn.addEventListener('click', () => ask(btn.dataset.mgmt));
});

$('btnMgmtDeleteSession').addEventListener('click', async () => {
    if (busy) return toast('Outra ação em andamento', 'err');
    busy = true;
    cooldown.set('delete-session', Date.now());
    const btn = $('btnMgmtDeleteSession');
    await doDeleteSession(btn);
    busy = false;
    setTimeout(() => setBtn(btn, null), 4000);
});

$('btnDashToggle').addEventListener('click', async () => {
    const on = cfg.dashboardChatBlocked !== true;
    const r = await api('/api/admin/config', { method: 'PUT', body: { updates: { dashboardChatBlocked: !on } } });
    if (!r.ok) { toast('Erro ao alterar', 'err'); return; }
    cfg.dashboardChatBlocked = !on;
    updateDashToggle();
    toast(on ? 'Chat do dashboard bloqueado' : 'Chat do dashboard liberado', 'ok');
});

function updateQRCodeToggle() {
    const on = cfg.dashboardShowQR === true;
    const btn = $('btnQRCodeToggle');
    btn.textContent = on ? '📱 Mostrando' : '📱 Oculto';
    btn.className = 'mgmt-btn' + (on ? ' ok' : '');
    btn.title = on ? 'Clique para esconder o QR Code do dashboard' : 'Clique para mostrar o QR Code no dashboard';
    $('qrCodeStatus').textContent = on ? 'visível' : 'oculto';
    $('qrCodeStatus').className = 'mgmt-status' + (on ? ' ok' : '');
}

$('btnQRCodeToggle').addEventListener('click', async () => {
    const on = cfg.dashboardShowQR === true;
    const r = await api('/api/admin/config', { method: 'PUT', body: { updates: { dashboardShowQR: !on } } });
    if (!r.ok) { toast('Erro ao alterar', 'err'); return; }
    cfg.dashboardShowQR = !on;
    updateQRCodeToggle();
    toast(on ? 'QR Code ocultado do dashboard' : 'QR Code visível no dashboard', 'ok');
});

// === Terminal style logs ===
const LOG_COLORS = { error: '#FF5555', warn: '#FFAA00', info: '#55CCCC', log: '#55FF55' };
const LOG_ICONS = { error: '✖', warn: '⚠', info: 'ℹ', log: '✓' };

const escHtml = s => s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

async function loadLogs() {
    let r;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        r = await fetch('/api/admin/logs', { credentials: 'same-origin', signal: controller.signal });
        clearTimeout(timer);
        r = { ok: r.ok, status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
    } catch {}
    if (!r || !r.ok) {
        const c = $('logsContainer');
        if (c) c.innerHTML = '<div style="color:#FF5555;padding:16px;font-weight:600">⛔ OFFLINE — servidor reiniciando…</div>';
        const cnt = $('logCount');
        if (cnt) cnt.textContent = '⛔ offline';
        return;
    }
    const logs = r.data?.logs || [];
    const c = $('logsContainer');
    const cnt = $('logCount');
    cnt.textContent = logs.length + (logs.length === 1 ? ' entrada' : ' entradas');
    if (!logs.length) {
        c.innerHTML = '<div style="color:#888;padding:20px">Nenhum log no buffer.</div><div style="color:#555">PS> </div>';
        return;
    }
    const prefix = logs.map(e => {
        const cl = LOG_COLORS[e.level] || '#ccc';
        const ic = LOG_ICONS[e.level] || '·';
        return `<span style="color:#666">[${e.time}]</span> <span style="color:${cl}">${ic}</span> ${escHtml(e.text)}`;
    }).join('\n');
    c.innerHTML = `<div style="white-space:pre-wrap;word-break:break-word">${prefix}</div>`;
    c.scrollTop = c.scrollHeight;
}
$('btnRefreshLogs').addEventListener('click', () => loadLogs());
let logsTimer = null, logsPaused = false;
function scheduleLogs() { if (!logsPaused) logsTimer = setTimeout(() => loadLogs(), 3000); }
// Sobrescreve loadLogs para auto-agendar após cada execução
const _origLoadLogs = loadLogs;
loadLogs = async () => { await _origLoadLogs(); scheduleLogs(); };
scheduleLogs();
$('logsContainer').addEventListener('mouseenter', () => { logsPaused = true; clearTimeout(logsTimer); $('logAutoStatus').textContent = '⏸ pausado'; });
$('logsContainer').addEventListener('mouseleave', () => { logsPaused = false; scheduleLogs(); $('logAutoStatus').textContent = '⏵ auto'; });

// === AI Usage ===
function fmtNumber(n) {
    if (n == null) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

function fmtDuration(ms) {
    if (!ms) return '—';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(d + 'd');
    if (h > 0) parts.push(h + 'h');
    if (m > 0) parts.push(m + 'min');
    if (parts.length === 0) parts.push(s + 's');
    return parts.join(' ');
}

async function loadAIUsage() {
    const c = $('aiUsageContainer');
    if (!c) return;
    let r;
    try { r = await api('/api/admin/ai-usage'); } catch {}
    if (!r || !r.ok) {
        c.innerHTML = '<div style="color:#FF5555;padding:12px;font-weight:600">⛔ offline</div>';
        return;
    }
    const u = r.data?.usage;
    if (!u) {
        c.innerHTML = '<div style="color:#888;padding:12px">Sem dados de uso.</div>';
        return;
    }
    const pctSuccess = u.totalRequests > 0 ? ((u.successfulRequests / u.totalRequests) * 100).toFixed(0) : '—';
    const pctCache = u.totalRequests > 0 ? ((u.cachedResponses / u.totalRequests) * 100).toFixed(0) : '—';
    const costEstimate = (u.totalTokensIn * 0.00000015 + u.totalTokensOut * 0.0000006).toFixed(6);
    c.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:8px">
        <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px 10px;text-align:center">
          <div style="color:#888;font-size:10px">REQUISIÇÕES</div>
          <div style="color:#e6edf3;font-size:16px;font-weight:700">${fmtNumber(u.totalRequests)}</div>
          <div style="color:#3fb950;font-size:10px">${fmtNumber(u.successfulRequests)} ok</div>
          <div style="color:#f85149;font-size:10px">${fmtNumber(u.failedRequests)} falhas</div>
        </div>
        <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px 10px;text-align:center">
          <div style="color:#888;font-size:10px">TOKENS</div>
          <div style="color:#e6edf3;font-size:16px;font-weight:700">${fmtNumber(u.totalTokensOut)}</div>
          <div style="color:#9aa6b2;font-size:10px">${fmtNumber(u.totalTokensIn)} input</div>
          <div style="color:#9aa6b2;font-size:10px">${fmtNumber(u.totalTokensOut)} output</div>
        </div>
        <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px 10px;text-align:center">
          <div style="color:#888;font-size:10px">CACHE</div>
          <div style="color:#e6edf3;font-size:16px;font-weight:700">${fmtNumber(u.cachedResponses)}</div>
          <div style="color:#d29922;font-size:10px">${pctCache}% das reqs</div>
          <div style="color:#9aa6b2;font-size:10px">${fmtNumber(u.cacheSize)} itens</div>
        </div>
        <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px 10px;text-align:center">
          <div style="color:#888;font-size:10px">SUCESSO</div>
          <div style="color:#e6edf3;font-size:16px;font-weight:700">${pctSuccess}%</div>
          <div style="color:#9aa6b2;font-size:10px">custo aprox.</div>
          <div style="color:#d29922;font-size:10px">US$ ${costEstimate}</div>
        </div>
      </div>
      <div style="background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px 10px;margin-bottom:6px">
        <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px">
          <span style="color:#888">Modelo:</span><span style="color:#e6edf3">${escHtml(u.config?.aiModel || '—')}</span>
          <span style="color:#888">Max tokens:</span><span style="color:#e6edf3">${u.config?.aiMaxTokens || '—'}</span>
          <span style="color:#888">Temperatura:</span><span style="color:#e6edf3">${u.config?.aiTemperature ?? '—'}</span>
          <span style="color:#888">Uptime:</span><span style="color:#e6edf3">${fmtDuration(u.uptimeMs)}</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button onclick="resetAIStats()" style="background:#1f2530;color:#f85149;border:1px solid #f85149;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">Redefinir</button>
      </div>`;
}

async function resetAIStats() {
    const r = await api('/api/admin/ai-usage', { method: 'POST' });
    if (r.ok) toast('Estatísticas redefinidas ✓', 'ok');
    else toast('Erro ao redefinir', 'err');
    loadAIUsage();
}

$('btnRefreshAI').addEventListener('click', loadAIUsage);
let aiTimer = setInterval(loadAIUsage, 5000);
$('aiUsageContainer').addEventListener('mouseenter', () => { clearInterval(aiTimer); $('aiAutoStatus').textContent = '⏸ pausado'; });
$('aiUsageContainer').addEventListener('mouseleave', () => { aiTimer = setInterval(loadAIUsage, 5000); $('aiAutoStatus').textContent = '⏵ auto'; });

// === Active Users ===
async function loadActiveUsers() {
    const c = $('activeUsersContainer');
    if (!c) return;
    const minutes = $('usersTimeWindow')?.value || 60;
    let r;
    try { r = await api('/api/admin/active-users?minutes=' + minutes); } catch {}
    if (!r || !r.ok) {
        c.innerHTML = '<div style="color:#FF5555;padding:12px;font-weight:600">⛔ offline</div>';
        return;
    }
    const users = r.data?.users || [];
    if (!users.length) {
        c.innerHTML = '<div style="color:#888;padding:12px">Nenhum usuário ativo no período.</div>';
        return;
    }
    c.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:11px">'
        + '<thead><tr style="color:#888;border-bottom:1px solid #333">'
        + '<th style="text-align:left;padding:4px 6px">Usuário</th>'
        + '<th style="text-align:left;padding:4px 6px">IP</th>'
        + '<th style="text-align:right;padding:4px 6px">Visitas</th>'
        + '<th style="text-align:right;padding:4px 6px">Último acesso</th>'
        + '</tr></thead><tbody>'
        + users.map(u => {
            const last = new Date(u.last_visit).toLocaleString('pt-BR');
            return `<tr style="border-bottom:1px solid #222">`
                + `<td style="padding:4px 6px;color:#e6edf3">${escHtml(u.username || '—')}</td>`
                + `<td style="padding:4px 6px;color:#9aa6b2">${escHtml(u.ip || '—')}</td>`
                + `<td style="padding:4px 6px;text-align:right;color:#d29922">${u.visit_count}</td>`
                + `<td style="padding:4px 6px;text-align:right;color:#9aa6b2">${last}</td>`
                + `</tr>`;
        }).join('')
        + '</tbody></table>'
        + `<div style="text-align:right;color:#888;font-size:10px;margin-top:6px">${users.length} usuário(s) nos últimos ${minutes} min</div>`;
}

$('btnRefreshUsers').addEventListener('click', loadActiveUsers);
$('usersTimeWindow').addEventListener('change', loadActiveUsers);

// === Visit History ===
async function loadVisitHistory() {
    const c = $('visitHistoryContainer');
    if (!c) return;
    const limit = $('visitsLimit')?.value || 50;
    let r;
    try { r = await api('/api/admin/visit-history?limit=' + limit); } catch {}
    if (!r || !r.ok) {
        c.innerHTML = '<div style="color:#FF5555;padding:12px;font-weight:600">⛔ offline</div>';
        return;
    }
    const visits = r.data?.visits || [];
    if (!visits.length) {
        c.innerHTML = '<div style="color:#888;padding:12px">Nenhuma visita registrada.</div>';
        return;
    }
    c.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:11px">'
        + '<thead><tr style="color:#888;border-bottom:1px solid #333">'
        + '<th style="text-align:left;padding:4px 6px">Horário</th>'
        + '<th style="text-align:left;padding:4px 6px">Usuário</th>'
        + '<th style="text-align:left;padding:4px 6px">IP</th>'
        + '<th style="text-align:left;padding:4px 6px">User Agent</th>'
        + '</tr></thead><tbody>'
        + visits.map(v => {
            const ts = new Date(v.timestamp).toLocaleString('pt-BR');
            const ua = (v.user_agent || '').length > 50 ? (v.user_agent || '').slice(0, 50) + '…' : (v.user_agent || '');
            return `<tr style="border-bottom:1px solid #222">`
                + `<td style="padding:4px 6px;color:#9aa6b2;white-space:nowrap">${ts}</td>`
                + `<td style="padding:4px 6px;color:#e6edf3">${escHtml(v.username || '—')}</td>`
                + `<td style="padding:4px 6px;color:#9aa6b2">${escHtml(v.ip || '—')}</td>`
                + `<td style="padding:4px 6px;color:#6e7681;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(ua)}</td>`
                + `</tr>`;
        }).join('')
        + '</tbody></table>';
}

$('btnRefreshVisits').addEventListener('click', loadVisitHistory);
$('visitsLimit').addEventListener('change', loadVisitHistory);

// === Connection Status ===
async function loadConnectionStatus() {
    const stateEl = $('connState');
    const phoneEl = $('connPhone');
    const qrContainer = $('qrContainer');
    const qrImage = $('qrImage');
    if (!stateEl) return;
    let r;
    try { r = await api('/api/admin/connection-status'); } catch {}
    if (!r || !r.ok) {
        stateEl.textContent = '⛔ Offline';
        stateEl.style.background = '#f8514933';
        stateEl.style.color = '#f85149';
        phoneEl.textContent = '—';
        qrContainer.style.display = 'none';
        return;
    }
    const d = r.data || {};
    switch (d.status) {
        case 'connected':
            stateEl.textContent = '🟢 Conectado';
            stateEl.style.background = '#3fb95033';
            stateEl.style.color = '#3fb950';
            phoneEl.textContent = d.phone || '—';
            qrContainer.style.display = 'none';
            break;
        case 'qr':
            stateEl.textContent = '🟡 QR Code';
            stateEl.style.background = '#d2992233';
            stateEl.style.color = '#d29922';
            phoneEl.textContent = 'escaneie abaixo';
            qrContainer.style.display = 'block';
            if (d.qr) {
                qrImage.src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(d.qr);
                qrImage.alt = 'QR Code';
            }
            break;
        case 'connecting':
            stateEl.textContent = '🟡 Conectando…';
            stateEl.style.background = '#d2992233';
            stateEl.style.color = '#d29922';
            phoneEl.textContent = '—';
            qrContainer.style.display = 'none';
            break;
        default:
            stateEl.textContent = '🔴 Desconectado';
            stateEl.style.background = '#f8514933';
            stateEl.style.color = '#f85149';
            phoneEl.textContent = '—';
            qrContainer.style.display = 'none';
            break;
    }
}

// === QR Control ===
async function loadQRStatus() {
    const infoEl = $('qrAttemptInfo');
    if (!infoEl) return;
    let r;
    try { r = await api('/api/admin/qr-status'); } catch {}
    if (!r || !r.ok) return;
    const d = r.data || {};
    const att = d.attempts || 0;
    const maxAtt = d.maxAttempts || 3;
    const stopped = d.stopped === true;
    if (stopped) {
        infoEl.innerHTML = `<span style="color:#f85149">⛔ Parado (${att}/${maxAtt})</span>`;
    } else if (att > 0) {
        infoEl.innerHTML = `<span style="color:#d29922">🟡 Tentativa ${att}/${maxAtt}</span>`;
    } else {
        infoEl.innerHTML = '';
    }
}

$('btnStopQR').addEventListener('click', async () => {
    const r = await api('/api/admin/stop-qr', { method: 'POST' });
    if (r.ok) { toast('QR parado', 'ok'); loadQRStatus(); }
    else toast('Erro', 'err');
});

$('btnResetQR').addEventListener('click', async () => {
    const r = await api('/api/admin/reset-qr', { method: 'POST' });
    if (r.ok) { toast('QR resetado — reinicie o bot', 'ok'); loadQRStatus(); }
    else toast('Erro', 'err');
});

// Update QR status when connection status changes
const _origLoadConn = loadConnectionStatus;
loadConnectionStatus = async () => {
    await _origLoadConn();
    loadQRStatus();
};

// Verificar atualizações ao carregar a página
load().then(() => { checkUpdates(); loadLogs(); loadAIUsage(); loadActiveUsers(); loadVisitHistory(); loadConnectionStatus(); updateQRCodeToggle(); });
let connTimer = setInterval(loadConnectionStatus, 4000);
