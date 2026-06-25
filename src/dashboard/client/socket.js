/* socket.js — conexão socket.io e todos os listeners (history, msg, reaction, groups, reset) */
(function (D) {
    'use strict';

    const state = D.state;
    const { reactionsHtml, rerender, rerenderOne, rerenderBatch, allMsgs, append } = D.render;
    const { renderGroups, selAll } = D.ui;
    const { toast } = D.utils;

    function mergeChunk(h) {
        const seen = new Set();
        for (const j of Object.keys(state.msgsByJid)) {
            for (const m of state.msgsByJid[j]) {
                if (m.messageId) seen.add(`${m.toJid}|${m.messageId}|${m.type}`);
            }
        }
        for (const d of (h || [])) {
            if (!d || !d.toJid) continue;
            if (d.messageId) {
                const k = `${d.toJid}|${d.messageId}|${d.type}`;
                if (seen.has(k)) continue;
                seen.add(k);
            }
            (state.msgsByJid[d.toJid] = state.msgsByJid[d.toJid] || []).push(d);
        }
        if (state.activeJid) rerenderBatch();
        renderGroups();
    }

    function bind() {
        const sock = io({
            transports: ['polling', 'websocket'],
            upgrade: true,
            rememberUpgrade: true,
            timeout: 20000,
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });

        sock.on('groups', list => {
            state.groups = Array.isArray(list) ? list : [];
            if (state.activeJid && state.activeJid !== D.ALL && state.groups.length && !state.groups.find(g => g.jid === state.activeJid)) {
                selAll();
            }
            renderGroups();
        });

        sock.on('history:start', () => { window.__histPending = 0; window.__histTotal = 0; });

        sock.on('history:chunk', h => {
            window.__histPending = (window.__histPending || 0) + 1;
            mergeChunk(h);
        });

        sock.on('history:end', () => { window.__histPending = 0; });

        sock.on('history', h => mergeChunk(h));

        sock.on('msg', d => {
            if (!d || !d.toJid) return;
            if (d.messageId) {
                const k = `${d.toJid}|${d.messageId}|${d.type}`;
                if ((state.msgsByJid[d.toJid] || []).some(m => `${m.toJid}|${m.messageId}|${m.type}` === k)) return;
            }
            (state.msgsByJid[d.toJid] = state.msgsByJid[d.toJid] || []).push(d);
            if (d.toJid === state.activeJid || state.activeJid === D.ALL) {
                append(d);
                setTimeout(() => {
                    if (D.refs.chat) D.refs.chat.scrollTop = D.refs.chat.scrollHeight;
                }, 30);
            }
            renderGroups();
        });

        sock.on('reaction', p => {
            if (!p || !p.targetId) return;
            const list = state.msgsByJid[p.targetJid] || [];
            const idx = list.findIndex(m => m.messageId === p.targetId && m.type === (p.targetType || m.type));
            if (idx >= 0) {
                const updated = (p.reactions && typeof p.reactions === 'object') ? p.reactions : {};
                list[idx].reactions = Object.keys(updated).length ? updated : undefined;
                rerenderOne(p.targetId);
            }
            // Fallback: atualiza DOM direto se a msg não está no array
            const el = document.querySelector(`.msg-bubble[data-mid="${CSS.escape(p.targetId)}"]`);
            if (el) {
                const old = el.querySelector('.msg-reactions');
                const rx = (p.reactions && typeof p.reactions === 'object') ? p.reactions : null;
                const html = reactionsHtml(rx);
                if (old && html) old.outerHTML = html;
                else if (old && !html) old.remove();
                else if (!old && html) {
                    const meta = el.querySelector('.msg-meta');
                    if (meta) meta.insertAdjacentHTML('beforebegin', html);
                }
            }
        });

        sock.on('connect', () => {
            if (D.refs.status) {
                D.refs.status.innerText = 'online';
                D.refs.status.style.color = 'var(--g)';
            }
        });

        sock.on('disconnect', () => {
            if (D.refs.status) {
                D.refs.status.innerText = 'reconectando…';
                D.refs.status.style.color = '#ff8182';
            }
        });

        sock.on('connect_error', (err) => {
            console.warn('[socket] connect_error:', err && err.message);
            if (D.refs.status) {
                D.refs.status.innerText = 'conectando…';
                D.refs.status.style.color = '#ff8182';
            }
        });

        sock.on('reset', () => {
            state.reset();
            if (D.refs.chat) D.refs.chat.innerHTML = '';
            if (state.activeJid) rerender();
            renderGroups();
            toast('🧹 Dashboard resetado');
        });
    }

    D.socket = { bind };
})(window.Dashboard = window.Dashboard || {});
