/* reply.js — composer, barra de reply, detecção click vs drag, envio via API */
(function (D) {
    'use strict';

    const { esc, toast, initials } = D.utils;
    const state = D.state;

    const CLICK_DRAG_THRESHOLD = 6;
    let _downX = 0, _downY = 0, _downEl = null, _downMoved = false;

    function setReply(t) {
        state.currentReply = t;
        const bar = D.refs.replyBar;
        const nameEl = D.refs.replyName;
        const textEl = D.refs.replyText;
        if (!t) return bar && bar.classList.remove('show');
        if (nameEl) nameEl.textContent = t.name || (t.phone ? '@' + t.phone : 'Mensagem');
        if (textEl) textEl.textContent = t.preview || (t.hasMedia ? '📎 Mídia' : '');
        if (bar) bar.classList.add('show');
    }

    function clearReply() {
        state.currentReply = null;
        const bar = D.refs.replyBar;
        if (bar) bar.classList.remove('show');
    }

    function openReply(el) {
        if (!state.activeJid) return toast('Selecione um grupo');
        const tj = el.dataset.tj;
        if (!tj) return toast('Sem identificação de destino');
        setReply({
            toJid: tj,
            messageId: el.dataset.mid,
            senderJid: el.dataset.sj,
            fromMe: el.dataset.fm === '1',
            phone: el.dataset.ph,
            name: el.dataset.nm,
            preview: el.dataset.pv || (el.dataset.hm === '1' ? '📎 Mídia' : ''),
            hasMedia: el.dataset.hm === '1'
        });
        if (D.refs.messageInput) D.refs.messageInput.focus();
    }

    function bindDragDetection() {
        const chat = D.refs.chat;
        if (!chat) return;
        chat.addEventListener('mousedown', e => {
            const bubble = e.target.closest('.msg-bubble');
            if (!bubble) return;
            _downX = e.clientX; _downY = e.clientY;
            _downEl = bubble; _downMoved = false;
        });
        chat.addEventListener('mousemove', e => {
            if (!_downEl) return;
            if (Math.abs(e.clientX - _downX) > CLICK_DRAG_THRESHOLD ||
                Math.abs(e.clientY - _downY) > CLICK_DRAG_THRESHOLD) {
                _downMoved = true;
            }
        });
        chat.addEventListener('mouseup', e => {
            const el = _downEl; _downEl = null;
            if (!el || _downMoved) return;
            if (e.target.closest('a,button,.msg-doc,.fr-dl,.ma-dl,input,textarea')) return;
            if (window.getSelection && window.getSelection().toString().length > 0) return;
            openReply(el);
        });
        chat.addEventListener('touchstart', e => {
            const bubble = e.target.closest('.msg-bubble');
            if (!bubble || !e.touches[0]) return;
            _downX = e.touches[0].clientX; _downY = e.touches[0].clientY;
            _downEl = bubble; _downMoved = false;
        }, { passive: true });
        chat.addEventListener('touchmove', e => {
            if (!_downEl || !e.touches[0]) return;
            if (Math.abs(e.touches[0].clientX - _downX) > CLICK_DRAG_THRESHOLD ||
                Math.abs(e.touches[0].clientY - _downY) > CLICK_DRAG_THRESHOLD) {
                _downMoved = true;
            }
        }, { passive: true });
        chat.addEventListener('touchend', () => {
            const el = _downEl; _downEl = null;
            if (!el || _downMoved) return;
            openReply(el);
        });
    }

    function autoSize() {
        const el = D.refs.messageInput;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    function syncCtx() {
        const bar = D.refs.ctxBar;
        if (!bar) return;
        const btns = bar.querySelectorAll('.ctx-btn[data-ctx]');
        for (const btn of btns) {
            const key = btn.dataset.ctx;
            btn.classList.toggle('active', !!state.contextInfo[key]);
        }
        const cf = D.refs.cardForm;
        if (cf) cf.style.display = state.contextInfo.hasCard ? 'flex' : 'none';
        const af = D.refs.actionLinkForm;
        if (af) af.style.display = state.contextInfo.hasActionLink ? 'flex' : 'none';
        const nf = D.refs.fwdNewsletterForm;
        if (nf) nf.style.display = state.contextInfo.hasFwdNewsletter ? 'flex' : 'none';
    }

    function toggleCtx(key) {
        state.toggleContextInfo(key);
        syncCtx();
    }

    function resetCtx() {
        state.resetContextInfo();
        syncCtx();
    }

    function getActiveCtxOptions() {
        const ctx = state.contextInfo || {};
        const out = {};
        if (ctx.forwarded) out.forwarded = true;
        if (ctx.mentionAll) out.mentionAll = true;
        if (ctx.ephemeral) out.ephemeral = true;
        if (ctx.hasCard) {
            out.hasCard = true;
            const title = (D.refs.cardTitle ? D.refs.cardTitle.value : '').trim();
            const body = (D.refs.cardBody ? D.refs.cardBody.value : '').trim();
            const thumb = (D.refs.cardThumb ? D.refs.cardThumb.value : '').trim();
            const url = (D.refs.cardUrl ? D.refs.cardUrl.value : '').trim();
            if (title) out.cardTitle = title;
            if (body) out.cardBody = body;
            if (thumb) out.cardThumb = thumb;
            if (url) out.cardUrl = url;
        }
        if (ctx.hasActionLink) {
            out.hasActionLink = true;
            const label = (D.refs.actionLinkLabel ? D.refs.actionLinkLabel.value : '').trim();
            const url = (D.refs.actionLinkUrl ? D.refs.actionLinkUrl.value : '').trim();
            if (label) out.actionLinkLabel = label;
            if (url) out.actionLinkUrl = url;
        }
        if (ctx.hasFwdNewsletter) {
            out.hasFwdNewsletter = true;
            const name = (D.refs.fwdNewsletterName ? D.refs.fwdNewsletterName.value : '').trim();
            if (name) out.fwdNewsletterName = name;
        }
        return out;
    }

    async function sendCurrent() {
        if (!state.activeJid) return toast('Selecione um grupo');
        if (state.chatBlocked) return toast('🔒 Chat bloqueado pelo admin');
        const tj = state.currentReply ? state.currentReply.toJid : state.activeJid;
        if (tj === D.ALL) return toast('Responda uma mensagem ou selecione um grupo');
        const text = (D.refs.messageInput ? D.refs.messageInput.value : '').trim();
        if (!text && !state.pendingAttachments.length) return toast('Digite ou anexe algo');
        if (D.refs.sendBtn) D.refs.sendBtn.disabled = true;
        try {
            const url = state.currentReply ? '/api/reply' : '/api/send';
            const body = state.currentReply
                ? {
                    toJid: tj,
                    text: text || '',
                    quotedId: state.currentReply.messageId,
                    quotedParticipant: state.currentReply.senderJid,
                    quotedFromMe: state.currentReply.fromMe,
                    quotedText: state.currentReply.preview || ''
                  }
                : { toJid: tj, text: text || '' };
            const ctxOpts = getActiveCtxOptions();
            if (Object.keys(ctxOpts).length) body.contextInfo = ctxOpts;
            if (state.pendingAttachments.length) body.media = state.pendingAttachments[0];
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const j = (r.headers.get('content-type') || '').includes('application/json') ? await r.json() : { ok: false };
            if (j.ok) {
                toast('✅ Enviado');
                if (D.refs.messageInput) D.refs.messageInput.value = '';
                autoSize();
                state.pendingAttachments = [];
                if (D.upload && D.upload.renderAtts) D.upload.renderAtts();
                clearReply();
            } else {
                toast('❌ ' + (j.error || 'falha'));
            }
        } catch (e) {
            toast('❌ ' + e.message);
        } finally {
            if (D.refs.sendBtn) D.refs.sendBtn.disabled = false;
        }
    }

    function bind() {
        bindDragDetection();
        const sendBtn = D.refs.sendBtn;
        const messageInput = D.refs.messageInput;
        if (sendBtn) sendBtn.addEventListener('click', sendCurrent);
        if (messageInput) {
            messageInput.addEventListener('input', autoSize);
            messageInput.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendCurrent();
                }
            });
        }
        syncCtx();
    }

    D.reply = {
        bind,
        openReply,
        setReply,
        clearReply,
        sendCurrent,
        toggleCtx,
        resetCtx,
        syncCtx
    };
})(window.Dashboard = window.Dashboard || {});
