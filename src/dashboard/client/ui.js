/* ui.js — lista lateral de grupos, seleção, busca, mobile tabbar, tema/som/push */
(function (D) {
    'use strict';

    const { esc, toast, initials } = D.utils;
    const state = D.state;

    function renderGroups() {
        const list = D.refs.groupList;
        if (!list) return;
        const f = (D.refs.groupSearch && D.refs.groupSearch.value || '').toLowerCase().trim();
        const filtered = state.groups.filter(g => !f || ((g.subject || g.jid.split('@')[0]).toLowerCase().includes(f)));
        let ac = 0;
        for (const j of Object.keys(state.msgsByJid)) ac += (state.msgsByJid[j] || []).length;

        const frag = document.createDocumentFragment();

        const all = document.createElement('li');
        all.className = 'group-item' + (state.activeJid === D.ALL ? ' active' : '');
        all.innerHTML = `<div class="group-avatar" style="background:var(--g);color:#00210e;">T</div><div class="group-meta"><div class="group-name">Todos</div><div class="group-sub">${ac} mensagem${ac !== 1 ? 's' : ''}</div></div>${ac ? `<div class="group-side"><div class="group-dot"></div><div class="group-badge">${ac > 99 ? '99+' : ac}</div></div>` : ''}`;
        all.onclick = () => selAll();
        frag.appendChild(all);

        if (!filtered.length) {
            const e = document.createElement('li');
            e.className = 'empty';
            e.innerHTML = 'Nenhum grupo com dashboard ativa ainda.<br><small>Use <code>!dashboard</code> em um grupo para ativá-lo.</small>';
            frag.appendChild(e);
        } else {
            for (const g of filtered) {
                const s = g.subject || g.jid.split('@')[0];
                const arr = state.msgsByJid[g.jid] || [];
                const c = arr.length;
                const r = arr.slice(-1)[0];
                const recent = r && (Date.now() - (r.timestamp || 0) < 5 * 60 * 1000);
                const senderPrefix = r && r.name ? `${r.name}: ` : '';
                const maxText = Math.max(1, 40 - senderPrefix.length);
                const sub = r
                    ? (senderPrefix + (r.text ? r.text.slice(0, maxText) : (r.media ? '📎 Mídia' : `${c} mensagem${c !== 1 ? 's' : ''}`)))
                    : `${c} mensagem${c !== 1 ? 's' : ''}`;
                const li = document.createElement('li');
                li.className = 'group-item' + (g.jid === state.activeJid ? ' active' : '');
                li.innerHTML = `${D.render.avatar(g)}<div class="group-meta"><div class="group-name">${esc(s)}</div><div class="group-sub">${esc(sub)}</div></div>${c ? `<div class="group-side">${recent ? '<div class="group-dot"></div>' : ''}<div class="group-badge">${c > 99 ? '99+' : c}</div></div>` : ''}`;
                li.onclick = () => selG(g.jid);
                frag.appendChild(li);
            }
        }
        list.innerHTML = '';
        list.appendChild(frag);
    }

    function setScreen(n) {
        document.body.setAttribute('data-screen', n);
        const tb = D.refs.mobileTabbar;
        if (tb) {
            for (const b of tb.querySelectorAll('.mt-tab')) {
                b.classList.toggle('active', b.dataset.tab === n);
            }
        }
    }

    function selAll() {
        state.activeJid = D.ALL;
        if (D.refs.chatName) D.refs.chatName.textContent = 'Todos os grupos';
        if (D.refs.chatSub) D.refs.chatSub.textContent = 'Visão geral de todas as conversas';
        if (D.refs.chatAvatar) D.refs.chatAvatar.innerHTML = '<div class="group-avatar" style="background:var(--g);color:#00210e;">T</div>';
        D.reply.clearReply();
        if (D.refs.messageInput) D.refs.messageInput.disabled = false;
        if (D.refs.sendBtn) D.refs.sendBtn.disabled = false;
        const ab = document.getElementById('attachBtn');
        if (ab) ab.disabled = false;
        setScreen('chat');
        D.render.rerenderBatch();
        renderGroups();
    }

    function selG(jid) {
        if (!jid) return;
        state.activeJid = jid;
        const g = state.groups.find(x => x.jid === jid);
        const s = (g && g.subject) || jid.split('@')[0];
        if (D.refs.chatName) D.refs.chatName.textContent = s;
        if (D.refs.chatSub) D.refs.chatSub.textContent = jid.split('@')[0];
        if (D.refs.chatAvatar) {
            D.refs.chatAvatar.innerHTML = (g && g.pictureUrl)
                ? `<img class="group-avatar" src="${esc(g.pictureUrl)}">`
                : `<div class="group-avatar">${esc(initials(s))}</div>`;
        }
        D.reply.clearReply();
        if (D.refs.messageInput) D.refs.messageInput.disabled = false;
        if (D.refs.sendBtn) D.refs.sendBtn.disabled = false;
        const ab = document.getElementById('attachBtn');
        if (ab) ab.disabled = false;
        setScreen('chat');
        D.render.rerenderBatch();
        renderGroups();
    }

    function setTheme(t) {
        const theme = t || localStorage.getItem('wa_theme') || 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('wa_theme', theme);
        document.querySelectorAll('.theme-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.theme === theme);
        });
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = theme === 'light' ? '#ffffff' : '#0b141a';
    }

    function applyTheme() {
        const saved = localStorage.getItem('wa_theme') || 'light';
        setTheme(saved);
    }

    function bindSidebar() {
        if (D.refs.groupSearch) D.refs.groupSearch.addEventListener('input', renderGroups);
        if (D.refs.backBtn) {
            D.refs.backBtn.addEventListener('click', () => {
                state.activeJid = null;
                setScreen('chats');
                if (D.refs.chatName) D.refs.chatName.textContent = 'Selecione um grupo';
                if (D.refs.chatSub) D.refs.chatSub.textContent = '—';
                if (D.refs.chatAvatar) D.refs.chatAvatar.innerHTML = '<div class="group-avatar">?</div>';
                if (D.refs.chat) D.refs.chat.innerHTML = '';
                renderGroups();
            });
        }
        if (D.refs.openStatsMobile) {
            D.refs.openStatsMobile.addEventListener('click', () => {
                setScreen('stats');
                if (D.stats && D.stats.refreshSys) D.stats.refreshSys();
            });
        }
        const tb = D.refs.mobileTabbar;
        if (tb) {
            for (const b of tb.querySelectorAll('.mt-tab')) {
                b.addEventListener('click', () => {
                    const t = b.dataset.tab;
                    if (t === 'chats') {
                        state.activeJid = null;
                        setScreen('chats');
                        if (D.refs.chat) D.refs.chat.innerHTML = '';
                        renderGroups();
                    } else if (t === 'chat') {
                        if (!state.activeJid) {
                            state.activeJid = D.ALL;
                            if (D.refs.chatName) D.refs.chatName.textContent = 'Todos';
                            D.render.rerenderBatch();
                            renderGroups();
                        }
                        setScreen('chat');
                    } else if (t === 'stats') {
                        setScreen('stats');
                        if (D.stats && D.stats.refreshSys) D.stats.refreshSys();
                    }
                });
            }
        }
    }

    D.ui = {
        renderGroups,
        selAll,
        selG,
        setScreen,
        setTheme,
        applyTheme,
        bind: bindSidebar
    };
})(window.Dashboard = window.Dashboard || {});
