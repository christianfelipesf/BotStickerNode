/* render.js — funções puras que retornam HTML de mensagens */
(function (D) {
    'use strict';

    const { esc, userColor, initials } = D.utils;
    const state = D.state;

    function avatar(g) {
        const s = g && (g.subject || (g.jid && g.jid.split('@')[0])) || '?';
        if (g && g.pictureUrl) {
            return `<img class="group-avatar" src="${esc(g.pictureUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
        }
        return `<div class="group-avatar">${esc(initials(s))}</div>`;
    }

    function reactionsHtml(rx) {
        if (!rx || !Object.keys(rx).length) return '';
        const em = Array.from(new Set(Object.values(rx)));
        const n = Object.keys(rx).length;
        return `<div class="msg-reactions">${em.join('')}${n > 1 ? ` <span>${n}</span>` : ''}</div>`;
    }

    function quotedHtml(q) {
        const name = esc(q.name || (q.phone ? '@' + q.phone : 'Mensagem'));
        const inner = q.text
            ? `<div class="msg-quote-text">${esc(q.text)}</div>`
            : (q.hasMedia ? `<div class="msg-quote-text">📎 Mídia</div>` : '');
        return `<div class="msg-quote"><div class="msg-quote-name">${name}</div>${inner}</div>`;
    }

    function mediaHtml(m) {
        if (!m) return '';
        if (m.type === 'image') {
            return `<div class="msg-media"><img src="${esc(m.url)}" loading="lazy"></div>`;
        }
        if (m.type === 'video') {
            return `<div class="msg-media"><video src="${esc(m.url)}" controls></video></div>`;
        }
        if (m.type === 'audio') {
            return `<div class="msg-media"><audio src="${esc(m.url)}" controls></audio></div>`;
        }
        if (m.type === 'sticker') {
            return `<div class="msg-media"><img src="${esc(m.url)}" style="width:140px;height:140px;"></div>`;
        }
        if (m.type === 'document') {
            const fn = m.fileName || 'arquivo';
            const kb = Math.max(1, Math.round((m.sizeBytes || 0) / 1024));
            return `<div class="msg-media"><a class="msg-doc" href="${esc(m.url)}" download="${esc(fn)}"><span class="msg-doc-icon">📎</span><span class="msg-doc-info"><span class="msg-doc-name">${esc(fn)}</span><span class="msg-doc-meta">${esc(m.mime || '')} · ${kb} KB</span></span></a></div>`;
        }
        return '';
    }

    function attachmentHtml(a) {
        if (!a || !a.fileName) return '';
        return mediaHtml({
            type: 'document',
            url: a.downloadUrl || `/api/files/download/${encodeURIComponent(a.fileName)}?dir=temp`,
            fileName: a.fileName,
            mime: a.mime || '',
            sizeBytes: a.sizeBytes || 0
        });
    }

    function msgBubbleHtml(d) {
        const me = !!d.fromMe;
        const accent = me ? '#ffd279' : userColor(d.phone);
        const inits = me ? '' : esc(initials(d.name || d.phone || '?'));
        const avatarHtml = me ? '' : `<div class="msg-avatar" style="background:${accent}">${inits}</div>`;
        const q = d.quoted ? quotedHtml(d.quoted) : '';
        const m = mediaHtml(d.media);
        const att = d.attachment ? attachmentHtml(d.attachment) : '';
        const rx = reactionsHtml(d.reactions);
        const note = d.type === 'action' ? `<div class="msg-system-inline">${esc(d.text || '')}</div>` : '';
        return `<div class="msg-wrapper ${me ? 'from-me' : 'from-other'}">${avatarHtml}<div class="msg-bubble" data-tj="${d.toJid || ''}" data-mid="${d.messageId || ''}" data-sj="${d.senderJid || ''}" data-fm="${me ? 1 : 0}" data-ph="${d.phone || ''}" data-nm="${esc(d.name || '')}" data-pv="${esc(d.text || '')}" data-hm="${d.media ? 1 : 0}">${q}${note}${m}${att}${d.text && d.type !== 'action' ? `<div class="msg-text">${esc(d.text)}</div>` : ''}<div class="msg-meta"><span class="msg-author" style="color:${accent}">${esc(d.name || 'Usuário')}</span><span>${esc(d.time || new Date(d.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span></div>${rx}</div></div>`;
    }

    function msgHtml(d) {
        const ds = new Date(d.timestamp || Date.now()).toLocaleDateString();
        let daySep = '';
        if (ds !== state.lastDate) {
            daySep = `<div class="msg-day-sep">${esc(ds === new Date().toLocaleDateString() ? 'Hoje' : ds)}</div>`;
            state.lastDate = ds;
        }
        if ((d.type === 'action' || d.type === 'error') && !d.attachment) {
            D.utils.play(d.type === 'error' ? D.refs.soundError : D.refs.soundAction);
            return daySep + `<div class="msg-system ${d.type === 'error' ? 'msg-error' : ''}">${esc(d.text || '')}</div>`;
        }
        return daySep + msgBubbleHtml(d);
    }

    function append(d) {
        const chat = D.refs.chat;
        chat.insertAdjacentHTML('beforeend', msgHtml(d));
        D.utils.play(D.refs.soundChat);
    }

    function rerender() {
        const chat = D.refs.chat;
        if (!state.activeJid) return;
        state.lastDate = '';
        chat.innerHTML = '';
        const list = state.activeJid === D.ALL ? state.allMsgs() : (state.msgsByJid[state.activeJid] || []);
        list.forEach(append);
        setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 30);
    }

    function rerenderOne(messageId) {
        const chat = D.refs.chat;
        const el = document.querySelector(`.msg-bubble[data-mid="${CSS.escape(messageId)}"]`);
        if (!el) return;
        const tj = el.dataset.tj;
        const list = state.msgsByJid[tj] || [];
        const d = list.find(x => x.messageId === messageId);
        if (!d) return;
        const wrapper = el.closest('.msg-wrapper');
        if (!wrapper) return;
        const prevHeight = chat.scrollHeight;
        const prevTop = chat.scrollTop;
        const tmp = document.createElement('div');
        tmp.innerHTML = msgBubbleHtml(d).trim();
        const newWrapper = tmp.firstElementChild;
        if (!newWrapper) return;
        wrapper.replaceWith(newWrapper);
        chat.scrollTop = prevTop + (chat.scrollHeight - prevHeight);
    }

    function rerenderBatch() {
        const chat = D.refs.chat;
        if (!state.activeJid) return;
        state.lastDate = '';
        chat.innerHTML = '';
        const list = state.activeJid === D.ALL ? state.allMsgs() : (state.msgsByJid[state.activeJid] || []);
        if (!list.length) return;
        const frag = [];
        for (const d of list) frag.push(msgHtml(d));
        chat.insertAdjacentHTML('beforeend', frag.join(''));
        setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 30);
        D.utils.play(D.refs.soundChat);
    }

    D.render = {
        avatar,
        mediaHtml,
        attachmentHtml,
        reactionsHtml,
        quotedHtml,
        msgHtml,
        msgBubbleHtml,
        append,
        rerender,
        rerenderOne,
        rerenderBatch,
        allMsgs: function () { return state.allMsgs(); }
    };
})(window.Dashboard = window.Dashboard || {});
