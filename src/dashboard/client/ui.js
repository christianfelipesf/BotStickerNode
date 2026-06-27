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

        if (state.showQr && state.qrCode) {
            const qr = document.createElement('li');
            qr.className = 'group-item' + (state.activeJid === '__qr__' ? ' active' : '');
            qr.innerHTML = `<div class="group-avatar" style="background:#d29922;color:#fff;">📱</div><div class="group-meta"><div class="group-name" style="color:#d29922">QR Code</div><div class="group-sub">Bot desconectado — escaneie para conectar</div></div><div class="group-side"><div class="group-dot" style="background:#d29922"></div></div>`;
            qr.onclick = () => selG('__qr__');
            frag.appendChild(qr);
        }

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

    function updateComposerBlocked() {
        if (state.activeJid === '__qr__') return;
        const blocked = state.chatBlocked;
        if (D.refs.messageInput) {
            D.refs.messageInput.disabled = blocked;
            D.refs.messageInput.placeholder = blocked ? 'Chat bloqueado pelo admin' : 'Mensagem';
        }
        if (D.refs.sendBtn) D.refs.sendBtn.disabled = blocked;
        const ab = document.getElementById('attachBtn');
        if (ab) ab.disabled = blocked;
        if (blocked && D.refs.chat) {
            const notice = document.getElementById('blockedNotice');
            if (!notice && D.refs.chat) {
                const n = document.createElement('div');
                n.id = 'blockedNotice';
                n.style.cssText = 'background:#f8514933;border:1px solid #f85149;border-radius:6px;padding:12px;margin:10px;text-align:center;font-size:13px;color:#f85149';
                n.textContent = '🔒 Chat bloqueado pelo admin — apenas visualização';
                D.refs.chat.parentNode.insertBefore(n, D.refs.chat);
            }
        } else {
            const notice = document.getElementById('blockedNotice');
            if (notice) notice.remove();
        }
    }

    function selAll() {
        state.activeJid = D.ALL;
        if (D.refs.chatName) D.refs.chatName.textContent = 'Todos os grupos';
        if (D.refs.chatSub) D.refs.chatSub.textContent = 'Visão geral de todas as conversas';
        if (D.refs.chatAvatar) D.refs.chatAvatar.innerHTML = '<div class="group-avatar" style="background:var(--g);color:#00210e;">T</div>';
        D.reply.clearReply();
        updateComposerBlocked();
        setScreen('chat');
        D.render.rerenderBatch();
        renderGroups();
    }

    function selG(jid) {
        if (!jid) return;
        state.activeJid = jid;

        if (jid === '__qr__') {
            if (D.refs.chatName) D.refs.chatName.textContent = 'QR Code';
            if (D.refs.chatSub) D.refs.chatSub.textContent = 'Bot desconectado';
            if (D.refs.chatAvatar) {
                D.refs.chatAvatar.innerHTML = '<div class="group-avatar" style="background:#d29922;color:#fff;font-size:20px">📱</div>';
            }
            D.reply.clearReply();
            if (D.refs.messageInput) D.refs.messageInput.disabled = true;
            if (D.refs.sendBtn) D.refs.sendBtn.disabled = true;
            const ab = document.getElementById('attachBtn');
            if (ab) ab.disabled = true;
            setScreen('chat');
            const chat = D.refs.chat;
            if (chat) {
                chat.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center;color:#9aa6b2;font-size:14px">'
                    + '<div style="font-size:16px;font-weight:600;color:#d29922;margin-bottom:16px">📱 Escaneie o QR Code para reconectar</div>'
                    + '<img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(state.qrCode || '') + '" style="width:250px;height:250px;border-radius:12px;background:#fff;padding:10px;image-rendering:pixelated;margin-bottom:16px">'
                    + '<div style="font-size:12px;max-width:300px;margin-bottom:16px">Abra o WhatsApp no seu celular, vá em <strong>Menu › Aparelhos conectados › Conectar um dispositivo</strong> e escaneie o QR Code acima.</div>'
                    + '<div id="qrChatControls" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">'
                    + '<button class="mgmt-btn" onclick="window.__stopQR()" style="background:#1f2530;color:#f85149;border:1px solid #f85149;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer">⏹️ Parar QR</button>'
                    + '<button class="mgmt-btn" onclick="window.__resetQR()" style="background:#1f2530;color:#3fb950;border:1px solid #3fb950;border-radius:6px;padding:7px 14px;font-size:12px;cursor:pointer">🔄 Resetar QR</button>'
                    + '<span id="qrChatInfo" style="font-size:11px;color:#9aa6b2;display:flex;align-items:center"></span>'
                    + '</div>'
                    + '</div>';
                window.__stopQR = function() {
                    fetch('/api/admin/stop-qr', { method: 'POST', credentials: 'same-origin' }).then(function(r) { return r.json(); }).then(function(d) {
                        if (d.ok) { toast('QR parado'); if (window.__loadQRInfo) window.__loadQRInfo(); }
                        else toast('Erro: ' + (d.error || '?')); }).catch(function() {});
                };
                window.__resetQR = function() {
                    fetch('/api/admin/reset-qr', { method: 'POST', credentials: 'same-origin' }).then(function(r) { return r.json(); }).then(function(d) {
                        if (d.ok) { toast('QR resetado'); if (window.__loadQRInfo) window.__loadQRInfo(); }
                        else toast('Erro: ' + (d.error || '?')); }).catch(function() {});
                };
                window.__loadQRInfo = function() {
                    fetch('/api/admin/qr-status', { credentials: 'same-origin' }).then(function(r) { return r.json(); }).then(function(d) {
                        if (!d.ok) return;
                        var el = document.getElementById('qrChatInfo');
                        if (!el) return;
                        var att = d.attempts || 0, maxAtt = d.maxAttempts || 3;
                        if (d.stopped) el.innerHTML = '<span style="color:#f85149">⛔ Parado (' + att + '/' + maxAtt + ')</span>';
                        else if (att > 0) el.innerHTML = '<span style="color:#d29922">🟡 Tentativa ' + att + '/' + maxAtt + '</span>';
                        else el.innerHTML = '';
                    }).catch(function() {});
                };
                window.__loadQRInfo();
            }
            renderGroups();
            return;
        }

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
        updateComposerBlocked();
        setScreen('chat');
        D.render.rerenderBatch();
        renderGroups();
    }

    function applyTheme() {
        const theme = localStorage.getItem('wa_theme') || 'light';
        document.documentElement.setAttribute('data-theme', theme);
        const btn = D.refs.themeBtn;
        if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = theme === 'light' ? '#ffffff' : '#0b141a';
    }

    function toggleTheme() {
        const cur = document.documentElement.getAttribute('data-theme') || 'light';
        const next = cur === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('wa_theme', next);
        const btn = D.refs.themeBtn;
        if (btn) btn.textContent = next === 'light' ? '☀️' : '🌙';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = next === 'light' ? '#ffffff' : '#0b141a';
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

    function updateQRImage() {
        if (state.activeJid !== '__qr__' || !state.qrCode) return;
        var img = document.querySelector('#chat img[alt="QR Code"]');
        if (img) {
            img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(state.qrCode);
        }
        if (window.__loadQRInfo) window.__loadQRInfo();
    }

    D.ui = {
        renderGroups,
        selAll,
        selG,
        setScreen,
        toggleTheme,
        applyTheme,
        bind: bindSidebar,
        updateComposerBlocked,
        updateQRImage
    };
})(window.Dashboard = window.Dashboard || {});
