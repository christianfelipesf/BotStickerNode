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
            path: '/socket.io',
            transports: ['polling', 'websocket'],
            upgrade: true,
            rememberUpgrade: false,
            timeout: 20000,
            reconnection: true,
            reconnectionAttempts: 15,
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

        sock.on('media:update', u => {
            if (!u || !u.messageId || !u.toJid) return;
            const list = state.msgsByJid[u.toJid] || [];
            const idx = list.findIndex(m => m.messageId === u.messageId && m.type === (u.type || m.type));
            if (idx >= 0) {
                list[idx].media = u.media || null;
                rerenderOne(u.messageId);
            }
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

        sock.on('connection:update', d => {
            if (!d) return;
            const wasQr = state.showQr;
            state.showQr = d.status === 'qr' && d.dashboardShowQR && !!d.qr;
            state.qrCode = d.qr || null;
            state.chatBlocked = d.dashboardChatBlocked === true;
            D.ui.updateComposerBlocked();
            if (d.status !== 'connected' && d.status !== 'qr') {
                state.groups = [];
                renderGroups();
            }
            if (state.showQr && d.qr) {
                state.qrMsgId = 'qr-' + (d.qr.length > 10 ? d.qr.slice(0, 10) : d.qr);
                const msg = {
                    type: 'chat',
                    group: 'QR Code',
                    text: 'Escaneie o QR Code abaixo para conectar o WhatsApp',
                    name: 'Sistema',
                    phone: 'qr',
                    media: {
                        type: 'image',
                        url: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(d.qr)
                    },
                    timestamp: Date.now(),
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    toJid: '__qr__',
                    messageId: state.qrMsgId,
                    fromMe: false
                };
                if (!state.msgsByJid['__qr__']) state.msgsByJid['__qr__'] = [];
                const exists = state.msgsByJid['__qr__'].some(m => m.messageId === state.qrMsgId);
                if (!exists) state.msgsByJid['__qr__'].push(msg);
            } else if (!state.showQr && wasQr) {
                delete state.msgsByJid['__qr__'];
                if (state.activeJid === '__qr__') {
                    state.activeJid = D.ALL;
                    D.ui.selAll();
                }
            }
            renderGroups();
            if (state.activeJid === '__qr__') rerender();
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
