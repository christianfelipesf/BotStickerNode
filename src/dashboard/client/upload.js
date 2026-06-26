/* upload.js — seleção, conversão de tipo e preview de anexos no composer */
(function (D) {
    'use strict';

    const { esc, toast } = D.utils;
    const state = D.state;

    function detectType(f) {
        const t = (f.type || '').toLowerCase();
        if (t === 'image/webp') return 'sticker';
        if (t.startsWith('image/')) return 'image';
        if (t.startsWith('video/')) return 'video';
        if (t.startsWith('audio/')) return 'audio';
        return 'document';
    }

    function allowedTypes(f) {
        const t = (f.type || '').toLowerCase();
        if (t.startsWith('image/')) return [{ id: 'image', l: '📷 Imagem' }, { id: 'sticker', l: '🏷️ Sticker' }];
        if (t.startsWith('video/')) return [{ id: 'video', l: '🎥 Vídeo' }];
        if (t.startsWith('audio/')) return [{ id: 'voice', l: '🎤 Voz' }, { id: 'audio', l: '🎵 Áudio' }];
        return [{ id: 'document', l: '📎 Documento' }];
    }

    function resizeImg(f) {
        return new Promise(r => {
            if (!f.type.startsWith('image/') || f.type === 'image/gif') return r(f);
            const rd = new FileReader();
            rd.onload = e => {
                const img = new Image();
                img.onload = () => {
                    const MAX = 1200;
                    let w = img.width, h = img.height;
                    if (w > MAX || h > MAX) {
                        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
                        else { w = Math.round(w * MAX / h); h = MAX; }
                    }
                    const cv = document.createElement('canvas');
                    cv.width = w; cv.height = h;
                    cv.getContext('2d').drawImage(img, 0, 0, w, h);
                    cv.toBlob(b => r(b ? new File([b], f.name, { type: 'image/jpeg', lastModified: Date.now() }) : f), 'image/jpeg', 0.8);
                };
                img.onerror = () => r(f);
                img.src = e.target.result;
            };
            rd.onerror = () => r(f);
            rd.readAsDataURL(f);
        });
    }

    function fileToUrl(f) {
        return new Promise((resolve, reject) => {
            const rd = new FileReader();
            rd.onload = () => resolve(rd.result);
            rd.onerror = reject;
            rd.readAsDataURL(f);
        });
    }

    function changeAttType(i, t) {
        state.pendingAttachments[i].sendType = t;
        state.pendingAttachments[i].type = t;
        if (state.pendingAttachments[i].detectedType === 'audio') {
            state.pendingAttachments[i].ptt = (t === 'voice');
        }
        renderAtts();
    }

    function removeAtt(i) {
        state.pendingAttachments.splice(i, 1);
        renderAtts();
    }

    function renderAtts() {
        const el = D.refs.attachments;
        if (!el) return;
        if (!state.pendingAttachments.length) {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = state.pendingAttachments.map((a, i) => {
            const preview = a.type === 'image' || a.type === 'sticker'
                ? `<img src="${a.previewUrl}">`
                : a.type === 'video' ? `<video src="${a.previewUrl}" muted></video>`
                : (a.type === 'audio' || a.type === 'voice') ? '🎵' : '📎';
            const opts = allowedTypes({ type: a.mime }).map(o =>
                `<button onclick="Dashboard.upload.changeAttType(${i},'${o.id}')" style="padding:2px 8px;font-size:11px;border-radius:999px;border:1px solid var(--b);background:${a.sendType === o.id ? 'var(--g)' : 'var(--pn2)'};color:${a.sendType === o.id ? '#00210e' : 'var(--tx)'};cursor:pointer;">${o.l}</button>`
            ).join('');
            const kb = Math.round(a.dataBase64.length * 0.75 / 1024);
            return `<div style="display:flex;gap:8px;padding:4px 10px 6px;align-items:flex-start;background:var(--pn2);border-radius:8px;"><div style="width:36px;height:36px;border-radius:6px;overflow:hidden;background:var(--pn);display:flex;align-items:center;justify-content:center;">${preview}</div><div style="flex:1;min-width:0;"><div style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.fileName)}</div><div style="font-size:11px;color:var(--dm);">${a.mime} · ${kb} KB</div><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">${opts}</div></div><button onclick="Dashboard.upload.removeAtt(${i})" style="background:transparent;border:none;color:var(--dm);cursor:pointer;font-size:16px;">✕</button></div>`;
        }).join('');
    }

    async function addFiles(files) {
        let added = 0;
        for (let f of Array.from(files || [])) {
            if (!f) continue;
            if (f.size > 16 * 1024 * 1024) { toast('Arquivo > 16MB'); continue; }
            f = await resizeImg(f);
            const detected = detectType(f);
            const opts = allowedTypes({ type: f.type });
            const sendType = (opts[0] ? opts[0].id : detected);
            const dataUrl = await fileToUrl(f);
            state.pendingAttachments.push({
                dataBase64: dataUrl.split(',')[1],
                detectedType: detected,
                sendType,
                type: sendType,
                mime: f.type,
                fileName: f.name,
                previewUrl: dataUrl,
                ptt: sendType === 'voice'
            });
            added++;
        }
        if (added) renderAtts();
    }

    async function handlePaste(e) {
        const cd = e.clipboardData || window.clipboardData;
        if (!cd || !cd.items) return;
        const files = [];
        for (const it of cd.items) {
            if (it.kind !== 'file') continue;
            const blob = it.getAsFile ? it.getAsFile() : null;
            if (!blob) continue;
            const t = (blob.type || '').toLowerCase();
            if (!t.startsWith('image/')) continue;
            const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
            const ext = (t.split('/')[1] || 'png').replace('jpeg', 'jpg');
            files.push(new File([blob], `print-${stamp}.${ext}`, { type: blob.type || 'image/png', lastModified: Date.now() }));
        }
        if (!files.length) return;
        e.preventDefault();
        if (!state.activeJid) { toast('Selecione um grupo'); return; }
        toast('📋 Imagem colada');
        await addFiles(files);
    }

    function bindPaste() {
        document.addEventListener('paste', handlePaste);
    }

    function bind() {
        const attachBtn = document.getElementById('attachBtn');
        const fileInput = D.refs.fileInput;
        if (!attachBtn || !fileInput) return;

        attachBtn.addEventListener('click', () => {
            if (!state.activeJid) return toast('Selecione um grupo');
            fileInput.click();
        });

        fileInput.addEventListener('change', async () => {
            await addFiles(fileInput.files);
            fileInput.value = '';
        });
    }

    D.upload = { bind, bindPaste, addFiles, renderAtts, changeAttType, removeAtt, detectType };
})(window.Dashboard = window.Dashboard || {});
