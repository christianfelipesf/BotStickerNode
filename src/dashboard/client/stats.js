/* stats.js — painel de estatísticas (CPU/RAM/uptime/grupos) e arquivos recentes */
(function (D) {
    'use strict';

    const { esc } = D.utils;
    const state = D.state;

    function fmtB(n) {
        if (!n && n !== 0) return '—';
        const u = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0, v = +n;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
        return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
    }

    function setBar(b, l, p, txt) {
        if (!b) return;
        const v = Math.max(0, Math.min(100, +p || 0));
        b.style.width = v.toFixed(1) + '%';
        b.style.background = v > 85
            ? 'linear-gradient(90deg,var(--er),#ffb84d)'
            : (v > 65 ? 'linear-gradient(90deg,var(--w),var(--t))' : 'linear-gradient(90deg,var(--g),var(--t))');
        if (l) l.textContent = txt;
    }

    function renderLogs() {
        const el = D.refs.sysLogs;
        if (!el) return;
        const r = state.allMsgs().slice(-30).reverse();
        if (!r.length) {
            el.innerHTML = '<div style="opacity:.7">Sem mensagens ainda.</div>';
            return;
        }
        el.innerHTML = r.map(m => {
            const tag = m.type === 'error' ? 'error'
                : (m.type === 'action' ? 'action' : (m.fromMe ? 'system' : ''));
            const label = tag ? tag.toUpperCase() : (m.fromMe ? 'BOT' : 'CHAT');
            const tm = m.time || new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const tx = (m.text || (m.media ? `[${m.media.type || 'mídia'}]` : '')).slice(0, 160);
            const w = m.name || (m.fromMe ? 'Você' : '');
            return `<div class="log-line"><span class="log-time">${esc(tm)}</span>${tag ? `<span class="log-tag ${tag}">${esc(label)}</span>` : ''}<span style="flex:1 1 100%;min-width:0;overflow-wrap:anywhere;word-break:break-word;">${w ? `<b>${esc(w)}:</b> ` : ''}${esc(tx)}</span></div>`;
        }).join('');
    }

    function renderFiles(arr) {
        const el = D.refs.sysFiles;
        if (!el) return;
        if (!Array.isArray(arr) || !arr.length) {
            el.innerHTML = '<div style="opacity:.7;font-size:11.5px;">Nenhum arquivo ainda.</div>';
            return;
        }
        el.innerHTML = arr.map(f => {
            const ext = (f.name.split('.').pop() || '').toLowerCase();
            const icon = (ext === 'zip' || ext === '7z' || ext === 'rar' || ext === 'tar' || ext === 'gz') ? '🗜️'
                : (ext === 'log' ? '📜'
                : (ext === 'txt' || ext === 'json' || ext === 'csv') ? '📄'
                : '📎');
            const ts = new Date(f.mtime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            return `<a class="file-row" href="${esc(f.downloadUrl)}" download="${esc(f.name)}" title="Baixar ${esc(f.name)}"><span class="fr-icon">${icon}</span><span class="fr-info"><span class="fr-name">${esc(f.name)}</span><span class="fr-meta">${esc(f.dir)} · ${f.sizeKb} KB · ${esc(ts)}</span></span></a>`;
        }).join('');
    }

    async function refreshFiles() {
        const el = D.refs.sysFiles;
        if (!el) return;
        try {
            const r = await fetch('/api/files', { cache: 'no-store' });
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || 'falha');
            renderFiles(d.files || []);
        } catch (_) { /* silencioso */ }
    }

    async function refreshSys() {
        try {
            const r = await fetch('/api/system', { cache: 'no-store' });
            const d = await r.json();
            if (!r.ok || !d.ok) throw new Error(d.error || 'falha');
            const set = (el, txt) => { if (el) el.textContent = txt; };
            set(D.refs.sysBotState, d.bot.connected ? '✅ Conectado' : '❌ Desconectado');
            set(D.refs.sysPid, String(d.pid));
            set(D.refs.sysRestarts, String(d.bot.totalRestarts || 0));
            set(D.refs.sysCommands, (d.bot.totalCommands || 0).toLocaleString('pt-BR'));

            const cp = d.cpu.userPct || 0;
            setBar(D.refs.cpuBar, D.refs.cpuLabel, cp, `${cp.toFixed(1)}% • ${d.cpus || 0} cores`);
            if (D.refs.cpuMeta) D.refs.cpuMeta.textContent = (d.cpuModel || '').slice(0, 64);

            const rp = d.memory.usedPct || 0;
            setBar(D.refs.ramBar, D.refs.ramLabel, rp, `${rp.toFixed(1)}% • ${fmtB(d.memory.usedBytes)} / ${fmtB(d.memory.totalBytes)}`);
            if (D.refs.ramMeta) D.refs.ramMeta.textContent = `Livre: ${fmtB(d.memory.freeBytes)}`;
            set(D.refs.procRss, fmtB(d.process.rssBytes));
            set(D.refs.procHeap, `${fmtB(d.process.heapUsedBytes)} / ${fmtB(d.process.heapTotalBytes)}`);
            set(D.refs.sysNode, d.nodeVersion || '—');
            set(D.refs.sysPlatform, `${d.platform} (${d.arch})`);
            set(D.refs.sysUptime, d.uptimeStr || '—');
            set(D.refs.sysGroupsTotal, String(d.bot.totalGroups || 0));
            set(D.refs.sysGroupsActive, String(d.bot.activeGroups || 0));
            set(D.refs.sysGroupsPartial, String(d.bot.partialGroups || 0));
            renderLogs();
        } catch (e) {
            if (D.refs.sysBotState) D.refs.sysBotState.textContent = 'erro: ' + (e.message || e);
        }
    }

    function start() {
        setInterval(refreshSys, 3000);
        refreshSys();
        setInterval(refreshFiles, 15000);
        refreshFiles();
    }

    D.stats = { start, refreshSys, refreshFiles, renderLogs, renderFiles, fmtB, setBar };
})(window.Dashboard = window.Dashboard || {});
