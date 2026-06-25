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
    const card = document.createElement('div');
    card.className = 'card' + (dirty.has(k) ? ' dirty' : '');
    card.dataset.key = k;

    const r1 = document.createElement('div'); r1.className = 'row1';
    const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = k;
    const tp = document.createElement('div'); tp.className = 'type'; tp.textContent = t === 'object' ? 'obj' : t;
    r1.append(nm, tp); card.appendChild(r1);

    const doc = window.Dashboard && window.Dashboard.configDocs ? window.Dashboard.configDocs[k] : null;
    if (doc) {
        const desc = document.createElement('div');
        desc.style.cssText = 'font-size:11px;color:#9aa6b2;margin:6px 0 4px;line-height:1.4';
        desc.textContent = doc;
        card.appendChild(desc);
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

async function load() {
    const r = await api('/api/admin/config');
    if (!r.ok) { if (r.status === 401) showLogin(); return; }
    cfg = clone(r.data.config); orig = clone(r.data.config); dirty.clear();
    $('userPill').textContent = '👤 ' + user;
    $('infoLine').textContent = `${r.data.botName || 'Bot'} • v${r.data.version || '?'} • ${r.data.platform || '?'} • restart #${r.data.restarts ?? '?'}`;
    showMain(); rerender();
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
    restart: { label: 'Reiniciar bot',        cmd: 'pm2 restart all', desc: 'Reinicia o bot via pm2. A sessão do dashboard será reconectada.' }
};
const cooldown = new Map();
const COOLDOWN_MS = 8 * 1000;
let busy = false;

const setStatus = (t, c) => { const el = $('mgmtStatus'); el.textContent = t; el.className = 'mgmt-status' + (c ? ' ' + c : ''); };
const setBtn = (btn, kind) => {
    if (!btn) return;
    btn.classList.remove('busy', 'ok', 'err');
    if (!btn.dataset.orig) btn.dataset.orig = btn.textContent;
    if (kind === 'busy') { btn.classList.add('busy'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> executando…'; }
    else if (kind === 'ok') { btn.classList.add('ok'); btn.disabled = false; btn.textContent = btn.dataset.orig; }
    else if (kind === 'err') { btn.classList.add('err'); btn.disabled = false; btn.textContent = btn.dataset.orig; }
    else { btn.disabled = false; btn.textContent = btn.dataset.orig; }
};

const ask = action => {
    const info = MGMT[action]; if (!info) return;
    if (Date.now() - (cooldown.get(action) || 0) < COOLDOWN_MS) return toast('Aguarde alguns segundos', 'err');
    if (busy) return toast('Outra ação em andamento', 'err');
    $('mgmtTitle').textContent = 'Confirmar: ' + info.label;
    $('mgmtDesc').textContent = info.desc;
    $('mgmtCmd').textContent = '$ ' + info.cmd;
    $('mgmtErr').textContent = '';
    $('mgmtConfirm').dataset.action = action;
    $('mgmtConfirm').textContent = 'Executar';
    $('mgmtConfirm').disabled = $('mgmtCancel').disabled = false;
    $('mgmtModal').classList.add('show');
};
$('mgmtCancel').addEventListener('click', () => $('mgmtModal').classList.remove('show'));

$('mgmtConfirm').addEventListener('click', async () => {
    const action = $('mgmtConfirm').dataset.action; if (!action) return;
    $('mgmtConfirm').disabled = $('mgmtCancel').disabled = true;
    busy = true; cooldown.set(action, Date.now());
    $('mgmtModal').classList.remove('show');

    const btn = $('btnMgmt' + action[0].toUpperCase() + action.slice(1));
    setBtn(btn, 'busy'); setStatus('Executando ' + action + '…');

    try {
        const r = await api('/api/admin/' + action, { method: 'POST' });
        const d = r.data || {};
        if (!r.ok) {
            const msg = d.error || ('HTTP ' + r.status);
            setBtn(btn, 'err'); setStatus('✗ ' + msg, 'err'); toast('Falha: ' + msg, 'err');
        } else if (action === 'update') {
            const txt = d.changed ? `atualizado ${d.before} → ${d.after}` : `sem alterações (${d.after || d.before})`;
            setBtn(btn, 'ok'); setStatus('✓ ' + txt, 'ok'); toast('git pull: ' + txt, 'ok');
        } else if (action === 'install') {
            setBtn(btn, d.ok !== false ? 'ok' : 'err');
            setStatus(d.ok !== false ? '✓ npm install concluído' : '✗ npm install falhou', d.ok !== false ? 'ok' : 'err');
            toast(d.ok !== false ? 'npm install ✓' : 'npm install falhou', d.ok !== false ? 'ok' : 'err');
        } else if (action === 'restart') {
            setBtn(btn, d.ok ? 'ok' : 'err');
            setStatus(d.ok ? '✓ pm2 restart enviado' : '✗ pm2 restart falhou', d.ok ? 'ok' : 'err');
            toast(d.ok ? 'Reiniciando…' : 'Falhou', d.ok ? 'ok' : 'err');
            if (d.ok) setTimeout(() => location.reload(), 3500);
        }
    } catch (e) {
        setBtn(btn, 'err'); setStatus('✗ ' + (e?.message || 'erro'), 'err'); toast('Erro: ' + (e?.message || 'falha'), 'err');
    } finally {
        busy = false;
        setTimeout(() => setBtn(btn, null), 4000);
    }
});

document.querySelectorAll('.mgmt-btn[data-mgmt]').forEach(btn => btn.addEventListener('click', () => ask(btn.dataset.mgmt)));

load();
