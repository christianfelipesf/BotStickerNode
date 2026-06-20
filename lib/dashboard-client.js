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
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const toastEl = document.getElementById('toast');

let lastDate = "";
let soundEnabled = false;
let pushEnabled = false;
let currentReply = null; // { toJid, messageId, senderJid, fromMe, name, preview }
let pendingAttachments = []; // [{ dataBase64, type, mime, fileName, previewUrl }]

function playSound(audio) {
    if (!soundEnabled) return;
    try { audio.currentTime = 0; const p = audio.play(); if (p && p.then) p.catch(() => {}); } catch (e) {}
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
        if (!("Notification" in window)) { alert("Sem suporte a notificações."); return; }
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
const savedTheme = localStorage.getItem('wa_theme') || 'dark';
setTheme(savedTheme);
soundEnabled = localStorage.getItem('wa_sound') === '1';
if (soundEnabled) { notifBtn.innerText = 'SOM ON'; notifBtn.style.background = 'var(--wa-green)'; }

function scrollToBottom() { setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 50); }
function getUserColor(phone) {
    if (!phone) return '#53bdeb';
    const colors = ['#3498db','#e74c3c','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#d35400','#c0392b','#27ae60','#2980b9','#8e44ad','#f39c12','#16a085','#7f8c8d'];
    let hash = 0;
    for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function detectMediaType(file) {
    const t = (file.type || '').toLowerCase();
    if (t === 'image/webp') return 'sticker';
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    return 'document';
}

// Tipos permitidos para seleção manual (apenas para mídia que o WhatsApp aceita converter)
function allowedSendTypes(file) {
    const t = (file.type || '').toLowerCase();
    const opts = [];
    if (t.startsWith('image/')) opts.push({ id: 'image', label: '📷 Imagem' }, { id: 'sticker', label: '🏷️ Sticker' });
    else if (t.startsWith('video/')) opts.push({ id: 'video', label: '🎥 Vídeo' });
    else if (t.startsWith('audio/')) opts.push({ id: 'audio', label: '🎵 Áudio (voz)' });
    else opts.push({ id: 'document', label: '📎 Documento' });
    return opts;
}

function resizeImageIfNeeded(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith('image/') || file.type === 'image/gif') {
            return resolve(file);
        }
        const reader = new FileReader();
        reader.onload = function (event) {
            const img = new Image();
            img.onload = function () {
                const maxDim = 1200;
                let width = img.width;
                let height = img.height;
                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob((blob) => {
                        if (blob) {
                            const resizedFile = new File([blob], file.name, {
                                type: 'image/jpeg',
                                lastModified: Date.now()
                            });
                            resolve(resizedFile);
                        } else {
                            resolve(file);
                        }
                    }, 'image/jpeg', 0.8);
                } else {
                    resolve(file);
                }
            };
            img.onerror = () => resolve(file);
            img.src = event.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

function renderAttachments() {
    attachmentsEl.innerHTML = '';
    if (pendingAttachments.length === 0) {
        attachmentsEl.classList.remove('show');
        return;
    }
    attachmentsEl.classList.add('show');
    pendingAttachments.forEach((att, i) => {
        const allowed = allowedSendTypes({ type: att.mime });
        const row = document.createElement('div');
        row.className = 'att-row';

        const prev = document.createElement('div');
        prev.className = 'att-preview';
        if (att.type === 'image' || att.type === 'sticker') {
            const img = document.createElement('img');
            img.src = att.previewUrl;
            prev.appendChild(img);
        } else if (att.type === 'video') {
            const v = document.createElement('video');
            v.src = att.previewUrl; v.muted = true;
            prev.appendChild(v);
        } else if (att.type === 'audio') {
            prev.innerHTML = '🎵';
        } else {
            prev.innerHTML = '📎';
        }

        const info = document.createElement('div');
        info.className = 'att-info';
        const name = document.createElement('div');
        name.className = 'att-name';
        name.textContent = att.fileName || 'anexo';
        const typeLabel = document.createElement('div');
        typeLabel.className = 'att-type';
        typeLabel.textContent = (att.mime || 'arquivo') + ' · ' + Math.round((att.dataBase64.length * 3) / 4 / 1024) + ' KB';
        info.appendChild(name);
        info.appendChild(typeLabel);

        if (allowed.length > 1) {
            const picker = document.createElement('div');
            picker.className = 'att-type-picker';
            allowed.forEach(opt => {
                const b = document.createElement('button');
                b.textContent = opt.label;
                if (att.sendType === opt.id) b.classList.add('active');
                b.onclick = () => { att.sendType = opt.id; att.type = opt.id; renderAttachments(); };
                picker.appendChild(b);
            });
            info.appendChild(picker);
        }

        const rm = document.createElement('button');
        rm.className = 'att-remove';
        rm.textContent = '✕';
        rm.onclick = () => { pendingAttachments.splice(i, 1); renderAttachments(); };

        row.appendChild(prev);
        row.appendChild(info);
        row.appendChild(rm);
        attachmentsEl.appendChild(row);
    });
}

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    for (let f of files) {
        if (f.size > 16 * 1024 * 1024) { showToast('Arquivo > 16MB'); continue; }
        f = await resizeImageIfNeeded(f);
        const detected = detectMediaType(f);
        const allowed = allowedSendTypes({ type: f.type });
        const sendType = allowed[0] ? allowed[0].id : detected;
        const dataUrl = await fileToDataUrl(f);
        const base64 = dataUrl.split(',')[1];
        pendingAttachments.push({
            dataBase64: base64,
            detectedType: detected,
            sendType,
            type: sendType,
            mime: f.type,
            fileName: f.name,
            previewUrl: dataUrl,
            ptt: detected === 'audio' && sendType === 'audio'
        });
    }
    renderAttachments();
});

function autoSize() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}
messageInput.addEventListener('input', autoSize);

function setReply(target) {
    currentReply = target;
    if (!target) {
        replyBar.classList.remove('show');
        return;
    }
    replyName.textContent = target.name || (target.phone ? '@' + target.phone : 'Mensagem');
    replyTextEl.textContent = target.preview || (target.hasMedia ? '📎 Mídia' : '');
    replyBar.classList.add('show');
}
function clearReply() { currentReply = null; replyBar.classList.remove('show'); }

async function sendCurrent() {
    const text = messageInput.value.trim();
    const hasText = text.length > 0;
    const hasMedia = pendingAttachments.length > 0;
    if (!hasText && !hasMedia) { showToast('Digite ou anexe algo'); return; }
    if (!currentReply && pendingAttachments.length === 0 && !text) return;

    // Se há reply: usa /api/reply (que faz a hidratação). Senão /api/send.
    sendBtn.disabled = true;

    try {
        let url = '/api/send';
        let body = {};

        if (currentReply) {
            url = '/api/reply';
            body = {
                toJid: currentReply.toJid,
                text: hasText ? text : '',
                quotedId: currentReply.messageId,
                quotedParticipant: currentReply.senderJid,
                quotedFromMe: currentReply.fromMe,
                quotedText: currentReply.preview || ''
            };
            if (hasMedia) body.media = pendingAttachments[0]; // 1 mídia por reply
        } else {
            url = '/api/send';
            body = { toJid: pendingTargetJid || '', text: hasText ? text : '' };
            if (pendingTargetJid) {
                if (hasMedia) body.media = pendingAttachments[0];
            } else {
                // Sem destino: exige uma mensagem selecionada (reply) ou destino conhecido
                showToast('Selecione uma mensagem para responder');
                sendBtn.disabled = false;
                return;
            }
        }

        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const ct = r.headers.get('content-type') || '';
        const j = ct.includes('application/json')
            ? await r.json()
            : { ok: false, error: 'Resposta inesperada do servidor (' + r.status + '). Recarregue o dashboard e confirme que o bot foi reiniciado.' };
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

let pendingTargetJid = null;

function quotedHtml(q) {
    if (!q) return '';
    const name = escapeHtml(q.name || (q.phone ? '@' + q.phone : 'Mensagem'));
    let inner;
    if (q.text) inner = `<div class="qtext">${escapeHtml(q.text)}</div>`;
    else if (q.hasMedia) inner = `<div class="qmedia">📎 Mídia</div>`;
    else inner = '';
    return `<div class="quoted-preview"><div class="qname">${name}</div>${inner}</div>`;
}
function mediaHtml(media) {
    if (!media) return '';
    if (media.type === 'image') return `<div class="media-container"><img src="${escapeHtml(media.url)}"></div>`;
    if (media.type === 'video') return `<div class="media-container"><video src="${escapeHtml(media.url)}" controls></video></div>`;
    if (media.type === 'audio') return `<div class="media-container"><audio src="${escapeHtml(media.url)}" controls></audio></div>`;
    if (media.type === 'sticker') return `<div class="media-container"><img src="${escapeHtml(media.url)}" style="width:120px;height:120px;background:none;"></div>`;
    return '';
}

function appendMessage(data, isNew = true) {
    const dateStr = new Date(data.timestamp || Date.now()).toLocaleDateString();
    if (dateStr !== lastDate) {
        const d = document.createElement('div');
        d.className = 'date-divider';
        d.innerText = dateStr === new Date().toLocaleDateString() ? "Hoje" : dateStr;
        chat.appendChild(d);
        lastDate = dateStr;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'msg-wrapper';

    let msgClass = "received";
    let typeTag = "";
    if (data.type === 'error') { msgClass = "system-error"; typeTag = '<span class="type-tag">ERRO</span>'; }
    else if (data.type === 'action') { msgClass = "bot-action"; typeTag = '<span class="type-tag">AÇÃO</span>'; }
    else if (data.type === 'event') { msgClass = "member-event"; typeTag = ''; }
    else if (data.type === 'viewonce') { msgClass = "viewonce"; typeTag = '<span class="type-tag" style="background:rgba(255,165,0,0.25);color:#ff9f43;">VIEWONCE</span>'; }

    if (data.fromMe && (data.type === 'chat' || data.type === 'viewonce')) msgClass = "sent";
    const userColor = getUserColor(data.phone);
    const inner = document.createElement('div');
    inner.className = 'msg ' + msgClass + (data.hidden ? ' hidden' : '');
    inner.dataset.toJid = data.toJid || '';
    inner.dataset.messageId = data.messageId || '';
    inner.dataset.senderJid = data.senderJid || '';
    inner.dataset.fromMe = data.fromMe ? '1' : '0';
    inner.dataset.group = data.group || '';
    inner.dataset.phone = data.phone || '';
    inner.dataset.name = data.name || '';
    inner.dataset.preview = data.text || '';
    inner.dataset.hasMedia = data.media ? '1' : '0';

    let html = '';
    if (data.hidden || data.type === 'viewonce') {
        html += '<div class="hidden-badge">👁️‍🗨️ ' + (data.type === 'viewonce' ? 'MÍDIA REVELADA' : 'MENSAGEM OCULTA') + '</div>';
    }
    if (data.type === 'chat' || data.type === 'viewonce') {
        html += `<div class="sender-info">
            <span class="sender" style="color: ${userColor}">${escapeHtml(data.name || 'Usuário')}</span>
            <span class="phone">${data.phone ? '@' + escapeHtml(data.phone) : ''}</span>
            <span class="group-name">${escapeHtml(data.group || 'Grupo')}</span>
        </div>`;
    } else {
        html += `<div class="sender-info">
            ${typeTag}
            <span class="group-name">${escapeHtml(data.group || 'Sistema')}</span>
        </div>`;
    }
    if (data.quoted) html += quotedHtml(data.quoted);
    html += mediaHtml(data.media);
    if (data.text) html += `<div class="text">${escapeHtml(data.text)}</div>`;
    html += `<div class="time-wrapper"><div class="time">${escapeHtml(data.time || new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}))}</div></div>`;
    inner.innerHTML = html;
    inner.addEventListener('click', () => openReplyFor(inner));
    wrapper.appendChild(inner);
    chat.appendChild(wrapper);

    if (isNew) {
        scrollToBottom();
        if (data.type === 'chat') playSound(soundChat);
        else if (data.type === 'action' || data.type === 'viewonce') playSound(soundAction);
        else if (data.type === 'error') playSound(soundError);

        if (pushEnabled && document.visibilityState !== 'visible') {
            let title = data.name ? `${data.name} (@${data.phone})` : (data.group || 'Nova mensagem');
            let body = (data.hidden || data.type === 'viewonce' ? '🔒 ' : '') + (data.text || (data.media ? 'Mídia' : 'Nova mensagem'));
            try { new Notification(title, { body, icon: 'https://ui-avatars.com/api/?name=' + encodeURIComponent(data.name || 'U') + '&background=25d366&color=fff' }); } catch (_) {}
        }
    }
}

function openReplyFor(el) {
    const toJid = el.dataset.toJid;
    const messageId = el.dataset.messageId;
    if (!toJid) {
        showToast('Sem identificação de destino');
        pendingTargetJid = null;
        return;
    }
    pendingTargetJid = toJid;
    const target = {
        toJid,
        messageId,
        senderJid: el.dataset.senderJid || undefined,
        fromMe: el.dataset.fromMe === '1',
        group: el.dataset.group,
        phone: el.dataset.phone,
        name: el.dataset.name,
        preview: el.dataset.preview || (el.dataset.hasMedia === '1' ? '📎 Mídia' : ''),
        hasMedia: el.dataset.hasMedia === '1'
    };
    setReply(target);
    messageInput.focus();
}

socket.on('history', (history) => { chat.innerHTML = ''; lastDate = ""; history.forEach(d => appendMessage(d, false)); scrollToBottom(); });
socket.on('msg', (data) => appendMessage(data));
socket.on('connect', () => { document.getElementById('status').innerText = 'Online'; document.getElementById('status').style.color = 'var(--wa-green)'; });
socket.on('disconnect', () => { document.getElementById('status').innerText = 'Reconectando...'; document.getElementById('status').style.color = '#ff8182'; });
