const socket = io();
const chat = document.getElementById('chat');
const soundChat = document.getElementById('sound-chat');
const soundAction = document.getElementById('sound-action');
const soundError = document.getElementById('sound-error');
const notifBtn = document.getElementById('notif-btn');
const pushBtn = document.getElementById('push-btn');
const replyBar = document.getElementById('replyBar');
const replyName = document.getElementById('replyName');
const replyTextEl = document.getElementById('replyText');
const attachmentsEl = document.getElementById('attachments');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const fileInput = document.getElementById('fileInput');
const toastEl = document.getElementById('toast');

let lastDate = "", soundEnabled = false, pushEnabled = false, currentReply = null, pendingAttachments = [], pendingTargetJid = null;

function playSound(audio) {
    if (!soundEnabled || !audio) return;
    try { audio.currentTime = 0; audio.play().catch(() => {}); } catch (_) {}
}
function showToast(msg, ms = 2000) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}
function toggleSound() {
    soundEnabled = !soundEnabled;
    notifBtn.innerText = soundEnabled ? 'SOM ON' : 'SOM';
    notifBtn.style.background = soundEnabled ? 'var(--wa-green)' : 'var(--wa-green-light)';
    if (soundEnabled) playSound(soundChat);
    localStorage.setItem('wa_sound', soundEnabled ? '1' : '0');
}
function togglePush() {
    if (!pushEnabled) {
        if (!("Notification" in window)) return alert("Sem suporte a notificações.");
        Notification.requestPermission().then(p => {
            if (p === "granted") { pushEnabled = true; pushBtn.innerText = "PUSH ON"; pushBtn.style.background = "#2980b9"; }
        });
    } else { pushEnabled = false; pushBtn.innerText = "PUSH"; pushBtn.style.background = "#3498db"; }
    localStorage.setItem('wa_push', pushEnabled ? '1' : '0');
}
function setTheme(t) { 
    document.body.className = t; 
    document.documentElement.setAttribute('data-theme', t === 'oled' ? 'dark' : t);
    localStorage.setItem('wa_theme', t); 
}
setTheme(localStorage.getItem('wa_theme') || 'dark');
soundEnabled = localStorage.getItem('wa_sound') === '1';
if (soundEnabled) { notifBtn.innerText = 'SOM ON'; notifBtn.style.background = 'var(--wa-green)'; }

const scrollToBottom = () => setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 50);

function getUserColor(phone) {
    if (!phone) return '#53bdeb';
    const colors = ['#3498db','#e74c3c','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#d35400','#c0392b','#27ae60','#2980b9','#8e44ad','#f39c12','#16a085','#7f8c8d'];
    let hash = 0;
    for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}
const escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');

const detectMediaType = (f) => {
    const t = (f.type || '').toLowerCase();
    return t === 'image/webp' ? 'sticker' : t.startsWith('image/') ? 'image' : t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : 'document';
};

const allowedSendTypes = (f) => {
    const t = (f.type || '').toLowerCase();
    if (t.startsWith('image/')) return [{ id: 'image', label: '📷 Imagem' }, { id: 'sticker', label: '🏷️ Sticker' }];
    if (t.startsWith('video/')) return [{ id: 'video', label: '🎥 Vídeo' }];
    if (t.startsWith('audio/')) return [{ id: 'audio', label: '🎵 Áudio' }];
    return [{ id: 'document', label: '📎 Documento' }];
};

function resizeImageIfNeeded(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith('image/') || file.type === 'image/gif') return resolve(file);
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const maxDim = 1200;
                let w = img.width, h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
                    else { w = Math.round((w * maxDim) / h); h = maxDim; }
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    canvas.toBlob((blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }) : file), 'image/jpeg', 0.8);
                } else resolve(file);
            };
            img.onerror = () => resolve(file);
            img.src = e.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

const fileToDataUrl = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
});

window.changeAttType = (i, type) => { pendingAttachments[i].sendType = type; pendingAttachments[i].type = type; renderAttachments(); };
window.removeAttachment = (i) => { pendingAttachments.splice(i, 1); renderAttachments(); };

function renderAttachments() {
    if (pendingAttachments.length === 0) {
        attachmentsEl.innerHTML = '';
        return attachmentsEl.classList.remove('show');
    }
    attachmentsEl.classList.add('show');
    attachmentsEl.innerHTML = pendingAttachments.map((att, i) => {
        const allowed = allowedSendTypes({ type: att.mime });
        const preview = (att.type === 'image' || att.type === 'sticker') ? `<img src="${att.previewUrl}">` :
                        (att.type === 'video') ? `<video src="${att.previewUrl}" muted></video>` :
                        (att.type === 'audio') ? '🎵' : '📎';
        const picker = allowed.length > 1 ? `<div class="att-type-picker">${allowed.map(opt => `
            <button class="${att.sendType === opt.id ? 'active' : ''}" onclick="changeAttType(${i}, '${opt.id}')">${opt.label}</button>
        `).join('')}</div>` : '';
        return `
            <div class="att-row">
                <div class="att-preview">${preview}</div>
                <div class="att-info">
                    <div class="att-name">${escapeHtml(att.fileName)}</div>
                    <div class="att-type">${att.mime} · ${Math.round(att.dataBase64.length * 0.75 / 1024)} KB</div>
                    ${picker}
                </div>
                <button class="att-remove" onclick="removeAttachment(${i})">✕</button>
            </div>
        `;
    }).join('');
}

document.getElementById('attachBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
    for (let f of Array.from(fileInput.files || [])) {
        if (f.size > 16 * 1024 * 1024) { showToast('Arquivo > 16MB'); continue; }
        f = await resizeImageIfNeeded(f);
        const detected = detectMediaType(f);
        const allowed = allowedSendTypes({ type: f.type });
        const sendType = allowed[0] ? allowed[0].id : detected;
        const dataUrl = await fileToDataUrl(f);
        pendingAttachments.push({
            dataBase64: dataUrl.split(',')[1],
            detectedType: detected, sendType, type: sendType,
            mime: f.type, fileName: f.name, previewUrl: dataUrl,
            ptt: detected === 'audio' && sendType === 'audio'
        });
    }
    fileInput.value = '';
    renderAttachments();
});

const autoSize = () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
};
messageInput.addEventListener('input', autoSize);

function setReply(target) {
    currentReply = target;
    if (!target) return replyBar.classList.remove('show');
    replyName.textContent = target.name || (target.phone ? '@' + target.phone : 'Mensagem');
    replyTextEl.textContent = target.preview || (target.hasMedia ? '📎 Mídia' : '');
    replyBar.classList.add('show');
}
const clearReply = () => { currentReply = null; replyBar.classList.remove('show'); };

async function sendCurrent() {
    const text = messageInput.value.trim();
    const hasText = text.length > 0;
    const hasMedia = pendingAttachments.length > 0;
    if (!hasText && !hasMedia) return showToast('Digite ou anexe algo');
    if (!currentReply && pendingAttachments.length === 0 && !text) return;

    sendBtn.disabled = true;
    try {
        let url = currentReply ? '/api/reply' : '/api/send';
        let body = currentReply ? {
            toJid: currentReply.toJid,
            text: hasText ? text : '',
            quotedId: currentReply.messageId,
            quotedParticipant: currentReply.senderJid,
            quotedFromMe: currentReply.fromMe,
            quotedText: currentReply.preview || ''
        } : { toJid: pendingTargetJid || '', text: hasText ? text : '' };

        if (!currentReply && !pendingTargetJid) {
            showToast('Selecione uma mensagem para responder');
            return sendBtn.disabled = false;
        }

        if (hasMedia) body.media = pendingAttachments[0];

        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const j = (r.headers.get('content-type') || '').includes('application/json') ? await r.json() : { ok: false };
        if (j.ok) {
            showToast('✅ Enviado');
            messageInput.value = '';
            autoSize();
            pendingAttachments = [];
            renderAttachments();
            clearReply();
        } else {
            showToast('❌ ' + (j.error || 'falha'));
        }
    } catch (e) {
        showToast('❌ ' + e.message);
    } finally {
        sendBtn.disabled = false;
    }
}

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
});

const quotedHtml = (q) => {
    const name = escapeHtml(q.name || (q.phone ? '@' + q.phone : 'Mensagem'));
    const inner = q.text ? `<div class="qtext">${escapeHtml(q.text)}</div>` : q.hasMedia ? `<div class="qmedia">📎 Mídia</div>` : '';
    return `<div class="quoted-preview"><div class="qname">${name}</div>${inner}</div>`;
};

const mediaHtml = (media) => {
    if (!media) return '';
    if (media.type === 'image') return `<div class="media-container"><img src="${escapeHtml(media.url)}"></div>`;
    if (media.type === 'video') return `<div class="media-container"><video src="${escapeHtml(media.url)}" controls></video></div>`;
    if (media.type === 'audio') return `<div class="media-container"><audio src="${escapeHtml(media.url)}" controls></audio></div>`;
    if (media.type === 'sticker') return `<div class="media-container"><img src="${escapeHtml(media.url)}" style="width:120px;height:120px;background:none;"></div>`;
    return '';
};

function appendMessage(data, isNew = true) {
    const dateStr = new Date(data.timestamp || Date.now()).toLocaleDateString();
    if (dateStr !== lastDate) {
        chat.insertAdjacentHTML('beforeend', `<div class="date-divider">${dateStr === new Date().toLocaleDateString() ? "Hoje" : dateStr}</div>`);
        lastDate = dateStr;
    }
    const msgClass = (data.type === 'error') ? "system-error" : 
                    (data.type === 'action') ? "bot-action" : 
                    (data.type === 'event') ? "member-event" : 
                    (data.type === 'viewonce') ? "viewonce" : "received";
    const finalClass = (data.fromMe && (data.type === 'chat' || data.type === 'viewonce')) ? 'msg sent' : `msg ${msgClass}`;
    const tag = data.type === 'error' ? '<span class="type-tag">ERRO</span>' :
                data.type === 'action' ? '<span class="type-tag">AÇÃO</span>' :
                data.type === 'viewonce' ? '<span class="type-tag" style="background:rgba(255,165,0,0.25);color:#ff9f43;">VIEWONCE</span>' : '';
    
    chat.insertAdjacentHTML('beforeend', `
        <div class="msg-wrapper">
            <div class="${finalClass} ${data.hidden ? 'hidden' : ''}" 
                 onclick="openReplyFor(this)"
                 data-to-jid="${data.toJid || ''}" 
                 data-message-id="${data.messageId || ''}" 
                 data-sender-jid="${data.senderJid || ''}" 
                 data-from-me="${data.fromMe ? '1' : '0'}" 
                 data-group="${data.group || ''}" 
                 data-phone="${data.phone || ''}" 
                 data-name="${data.name || ''}" 
                 data-preview="${data.text || ''}" 
                 data-has-media="${data.media ? '1' : '0'}">
                ${(data.hidden || data.type === 'viewonce') ? `<div class="hidden-badge">👁️‍🗨️ ${data.type === 'viewonce' ? 'MÍDIA REVELADA' : 'MENSAGEM OCULTA'}</div>` : ''}
                <div class="sender-info">
                    ${tag || (data.type === 'chat' || data.type === 'viewonce' ? `<span class="sender" style="color: ${getUserColor(data.phone)}">${escapeHtml(data.name || 'Usuário')}</span><span class="phone">${data.phone ? '@' + escapeHtml(data.phone) : ''}</span>` : '')}
                    <span class="group-name">${escapeHtml(data.group || (data.type === 'chat' || data.type === 'viewonce' ? 'Grupo' : 'Sistema'))}</span>
                </div>
                ${data.quoted ? quotedHtml(data.quoted) : ''}
                ${mediaHtml(data.media)}
                ${data.text ? `<div class="text">${escapeHtml(data.text)}</div>` : ''}
                <div class="time-wrapper"><div class="time">${escapeHtml(data.time || new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}))}</div></div>
            </div>
        </div>
    `);

    if (isNew) {
        scrollToBottom();
        playSound(data.type === 'chat' ? soundChat : (data.type === 'action' || data.type === 'viewonce') ? soundAction : data.type === 'error' ? soundError : null);
        if (pushEnabled && document.visibilityState !== 'visible') {
            let title = data.name ? `${data.name} (@${data.phone})` : (data.group || 'Nova mensagem');
            let body = (data.hidden || data.type === 'viewonce' ? '🔒 ' : '') + (data.text || (data.media ? 'Mídia' : 'Nova mensagem'));
            try { new Notification(title, { body, icon: 'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.name || 'U') + '&background=25d366&color=fff' }); } catch (_) {}
        }
    }
}

function openReplyFor(el) {
    const toJid = el.dataset.toJid;
    if (!toJid) return showToast('Sem identificação de destino');
    pendingTargetJid = toJid;
    setReply({
        toJid,
        messageId: el.dataset.messageId,
        senderJid: el.dataset.senderJid || undefined,
        fromMe: el.dataset.fromMe === '1',
        group: el.dataset.group,
        phone: el.dataset.phone,
        name: el.dataset.name,
        preview: el.dataset.preview || (el.dataset.hasMedia === '1' ? '📎 Mídia' : ''),
        hasMedia: el.dataset.hasMedia === '1'
    });
    messageInput.focus();
}

socket.on('history', (history) => { chat.innerHTML = ''; lastDate = ""; history.forEach(d => appendMessage(d, false)); scrollToBottom(); });
socket.on('msg', (data) => appendMessage(data));
socket.on('connect', () => { document.getElementById('status').innerText = 'Online'; document.getElementById('status').style.color = 'var(--wa-green)'; });
socket.on('disconnect', () => { document.getElementById('status').innerText = 'Reconectando...'; document.getElementById('status').style.color = '#ff8182'; });
