const socket = io();
const chat = document.getElementById('chat');
const groupList = document.getElementById('groupList');
const groupSearch = document.getElementById('groupSearch');
const chatName = document.getElementById('chatName');
const chatSub = document.getElementById('chatSub');
const chatAvatar = document.getElementById('chatAvatar');
const statusEl = document.getElementById('status');
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
const composerEl = document.getElementById('composer');
const toastEl = document.getElementById('toast');
const backBtn = document.getElementById('backBtn');
const sidebarEl = document.getElementById('sidebar');

const ALL_CHAT_ID = '__all__';
let groups = [];
let activeJid = null;
let messagesByGroup = {};
let knownGroupJids = new Set();
let lastDate = "";
let soundEnabled = false, pushEnabled = false;
let currentReply = null, pendingAttachments = [];

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
    notifBtn.classList.toggle('active', soundEnabled);
    if (soundEnabled) playSound(soundChat);
    localStorage.setItem('wa_sound', soundEnabled ? '1' : '0');
}
function togglePush() {
    if (!pushEnabled) {
        if (!("Notification" in window)) return alert("Sem suporte a notificações.");
        Notification.requestPermission().then(p => {
            if (p === "granted") { pushEnabled = true; pushBtn.innerText = "PUSH ON"; pushBtn.classList.add('active'); }
        });
    } else { pushEnabled = false; pushBtn.innerText = "PUSH"; pushBtn.classList.remove('active'); }
    localStorage.setItem('wa_push', pushEnabled ? '1' : '0');
}
function setTheme(t) {
    document.body.className = t;
    document.documentElement.setAttribute('data-theme', t === 'oled' ? 'dark' : t);
    localStorage.setItem('wa_theme', t);
}
setTheme(localStorage.getItem('wa_theme') || 'dark');
soundEnabled = localStorage.getItem('wa_sound') === '1';
if (soundEnabled) { notifBtn.innerText = 'SOM ON'; notifBtn.classList.add('active'); }

const scrollToBottom = () => setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 30);

function getUserColor(phone) {
    if (!phone) return 'var(--wa-green)';
    const colors = ['#3498db','#e74c3c','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#d35400','#c0392b','#27ae60','#2980b9','#8e44ad','#f39c12','#16a085'];
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
const fileToDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

window.changeAttType = (i, type) => { pendingAttachments[i].sendType = type; pendingAttachments[i].type = type; renderAttachments(); };
window.removeAttachment = (i) => { pendingAttachments.splice(i, 1); renderAttachments(); };

function renderAttachments() {
    if (pendingAttachments.length === 0) { attachmentsEl.innerHTML = ''; return attachmentsEl.classList.remove('show'); }
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

document.getElementById('attachBtn').addEventListener('click', () => { if (!activeJid) return showToast('Selecione um grupo'); fileInput.click(); });
fileInput.addEventListener('change', async () => {
    for (let f of Array.from(fileInput.files || [])) {
        if (f.size > 16 * 1024 * 1024) { showToast('Arquivo > 16MB'); continue; }
        f = await resizeImageIfNeeded(f);
        const detected = detectMediaType(f);
        const allowed = allowedSendTypes({ type: f.type });
        const sendType = allowed[0] ? allowed[0].id : detected;
        const dataUrl = await fileToDataUrl(f);
        pendingAttachments.push({
            dataBase64: dataUrl.split(',')[1], detectedType: detected, sendType, type: sendType,
            mime: f.type, fileName: f.name, previewUrl: dataUrl, ptt: detected === 'audio' && sendType === 'audio'
        });
    }
    fileInput.value = '';
    renderAttachments();
});

const autoSize = () => { messageInput.style.height = 'auto'; messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px'; };
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
    if (!activeJid) return showToast('Selecione um grupo');
    const targetJid = currentReply?.toJid || activeJid;
    if (targetJid === ALL_CHAT_ID) return showToast('Responda uma mensagem ou selecione um grupo');
    const text = messageInput.value.trim();
    const hasText = text.length > 0;
    const hasMedia = pendingAttachments.length > 0;
    if (!hasText && !hasMedia) return showToast('Digite ou anexe algo');

    sendBtn.disabled = true;
    try {
        let url = currentReply ? '/api/reply' : '/api/send';
        let body = currentReply ? {
            toJid: targetJid, text: hasText ? text : '',
            quotedId: currentReply.messageId, quotedParticipant: currentReply.senderJid,
            quotedFromMe: currentReply.fromMe, quotedText: currentReply.preview || ''
        } : { toJid: targetJid, text: hasText ? text : '' };
        if (hasMedia) body.media = pendingAttachments[0];

        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = (r.headers.get('content-type') || '').includes('application/json') ? await r.json() : { ok: false };
        if (j.ok) {
            showToast('✅ Enviado');
            messageInput.value = ''; autoSize();
            pendingAttachments = []; renderAttachments(); clearReply();
        } else { showToast('❌ ' + (j.error || 'falha')); }
    } catch (e) { showToast('❌ ' + e.message); }
    finally { sendBtn.disabled = false; }
}
messageInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); } });

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

function initialsFor(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function avatarHtml(group, cls = 'gl-avatar') {
    const subj = group?.subject || group?.jid?.split('@')[0] || '?';
    if (group?.pictureUrl) {
        return `<img class="${cls}" src="${escapeHtml(group.pictureUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    }
    return `<div class="${cls}">${escapeHtml(initialsFor(subj))}</div>`;
}

function groupNameForJid(jid) {
    return groups.find(g => g.jid === jid)?.subject || jid.split('@')[0];
}

function allMessages() {
    return Object.values(messagesByGroup)
        .flat()
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function rerenderActiveChat() {
    if (!activeJid) return;
    lastDate = '';
    chat.innerHTML = '';
    const list = activeJid === ALL_CHAT_ID ? allMessages() : (messagesByGroup[activeJid] || []);
    list.forEach(d => appendMessage(d));
    scrollToBottom();
}

function renderReactions(reactions) {
    if (!reactions || Object.keys(reactions).length === 0) return '';
    const emojis = Array.from(new Set(Object.values(reactions)));
    const count = Object.keys(reactions).length;
    return `<div class="msg-reactions">${emojis.join('')}${count > 1 ? ` <span class="reactions-count">${count}</span>` : ''}</div>`;
}

function appendMessage(data) {
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
    
    const reactionsHtml = renderReactions(data.reactions);
    
    chat.insertAdjacentHTML('beforeend', `
        <div class="msg-wrapper">
            <div class="${finalClass} ${data.hidden ? 'hidden' : ''}"
                 onclick="openReplyFor(this)"
                 data-to-jid="${data.toJid || ''}"
                 data-message-id="${data.messageId || ''}"
                 data-sender-jid="${data.senderJid || ''}"
                 data-from-me="${data.fromMe ? '1' : '0'}"
                 data-phone="${data.phone || ''}"
                 data-name="${data.name || ''}"
                 data-preview="${data.text || ''}"
                 data-has-media="${data.media ? '1' : '0'}">
                ${(data.hidden || data.type === 'viewonce') ? `<div class="hidden-badge">👁️‍🗨️ ${data.type === 'viewonce' ? 'MÍDIA REVELADA' : 'MENSAGEM OCULTA'}</div>` : ''}
                <div class="sender-info">
                    ${activeJid === ALL_CHAT_ID && data.toJid ? `<span class="group-name">${escapeHtml(groupNameForJid(data.toJid))}</span>` : ''}
                    ${tag || (data.type === 'chat' || data.type === 'viewonce' ? `<span class="sender" style="color: ${getUserColor(data.phone)}">${escapeHtml(data.name || 'Usuário')}</span><span class="phone">${data.phone ? '@' + escapeHtml(data.phone) : ''}</span>` : '')}
                </div>
                ${data.quoted ? quotedHtml(data.quoted) : ''}
                ${mediaHtml(data.media)}
                ${data.text ? `<div class="text">${escapeHtml(data.text)}</div>` : ''}
                <div class="time-wrapper"><div class="time">${escapeHtml(data.time || new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}))}</div></div>
                ${reactionsHtml}
            </div>
        </div>
    `);
    playSound(data.type === 'chat' ? soundChat : (data.type === 'action' || data.type === 'viewonce') ? soundAction : data.type === 'error' ? soundError : null);
    if (pushEnabled && document.visibilityState !== 'visible') {
        const title = data.name ? `${data.name}` : (data.group || 'Nova mensagem');
        const body = (data.hidden || data.type === 'viewonce' ? '🔒 ' : '') + (data.text || (data.media ? 'Mídia' : 'Nova mensagem'));
        try { new Notification(title, { body }); } catch (_) {}
    }
}

function openReplyFor(el) {
    if (!activeJid) return showToast('Selecione um grupo');
    const toJid = el.dataset.toJid;
    if (toJid && !knownGroupJids.has(toJid)) return showToast('Grupo indisponivel no dashboard');
    if (!toJid) return showToast('Sem identificação de destino');
    setReply({
        toJid, messageId: el.dataset.messageId,
        senderJid: el.dataset.senderJid || undefined, fromMe: el.dataset.fromMe === '1',
        phone: el.dataset.phone, name: el.dataset.name,
        preview: el.dataset.preview || (el.dataset.hasMedia === '1' ? '📎 Mídia' : ''),
        hasMedia: el.dataset.hasMedia === '1'
    });
    messageInput.focus();
}

function renderGroups() {
    const filter = (groupSearch.value || '').toLowerCase().trim();
    const filtered = groups.filter(g => !filter || (g.subject || g.jid.split('@')[0]).toLowerCase().includes(filter));
    const allCount = allMessages().length;
    const allVisible = !filter || 'todos geral todas mensagens'.includes(filter);
    if (filtered.length === 0 && !allVisible) {
        groupList.innerHTML = `<li class="empty">${groups.length === 0 ? 'Nenhum grupo com dashboard ativa ainda.<br><small>Use <code>!dashboard</code> em um grupo para ativá-lo.</small>' : 'Nenhum resultado.'}</li>`;
        return;
    }
    const allItem = allVisible ? `<li class="${activeJid === ALL_CHAT_ID ? 'active' : ''}" onclick="selectAllChat()">
            <div class="gl-avatar all-avatar">T</div>
            <div class="gl-info">
                <div class="gl-name">Todos</div>
                <div class="gl-sub">${allCount} mensagem${allCount !== 1 ? 's' : ''}</div>
            </div>
        </li>` : '';
    const groupItems = filtered.map(g => {
        const subj = g.subject || g.jid.split('@')[0];
        const count = (messagesByGroup[g.jid] || []).length;
        const isActive = g.jid === activeJid ? 'active' : '';
        return `<li class="${isActive}" data-jid="${g.jid}" onclick="selectGroup('${g.jid}')">
            ${avatarHtml(g)}
            <div class="gl-info">
                <div class="gl-name">${escapeHtml(subj)}</div>
                <div class="gl-sub">${count} mensagem${count !== 1 ? 's' : ''}</div>
            </div>
        </li>`;
    }).join('');
    groupList.innerHTML = allItem + groupItems;
}

window.selectAllChat = () => {
    activeJid = ALL_CHAT_ID;
    chatName.textContent = 'Todos';
    chatSub.textContent = 'Mensagens de todos os grupos';
    chatAvatar.innerHTML = '<div class="ch-avatar-img all-avatar">T</div>';
    clearReply();
    document.body.classList.add('chat-open');
    messageInput.disabled = false;
    sendBtn.disabled = false;
    document.getElementById('attachBtn').disabled = false;
    composerEl.classList.remove('disabled');
    rerenderActiveChat();
    renderGroups();
};

window.selectGroup = (jid) => {
    if (!jid || (knownGroupJids.size && !knownGroupJids.has(jid))) return showToast('Grupo indisponivel no dashboard');
    activeJid = jid;
    const g = groups.find(x => x.jid === jid);
    const subj = g?.subject || jid.split('@')[0];
    chatName.textContent = subj;
    chatSub.textContent = jid.split('@')[0];
    chatAvatar.innerHTML = avatarHtml(g, 'ch-avatar-img');
    clearReply();
    document.body.classList.add('chat-open');
    messageInput.disabled = false;
    sendBtn.disabled = false;
    document.getElementById('attachBtn').disabled = false;
    composerEl.classList.remove('disabled');
    rerenderActiveChat();
    renderGroups();
};
groupSearch.addEventListener('input', renderGroups);
backBtn.addEventListener('click', () => { document.body.classList.remove('chat-open'); activeJid = null; renderGroups(); });

socket.on('groups', (list) => {
    groups = Array.isArray(list) ? list : [];
    knownGroupJids = new Set(groups.map(g => g.jid).filter(Boolean));
    if (activeJid && activeJid !== ALL_CHAT_ID && knownGroupJids.size && !knownGroupJids.has(activeJid)) {
        selectAllChat();
    }
    renderGroups();
});
socket.on('history', (history) => {
    const incoming = Array.isArray(history) ? history : [];
    const existingKeys = new Set();
    for (const jid of Object.keys(messagesByGroup)) {
        for (const m of messagesByGroup[jid]) {
            if (m.messageId) existingKeys.add(`${m.toJid}|${m.messageId}|${m.type}`);
        }
    }
    for (const d of incoming) {
        if (!d || !d.toJid) continue;
        if (d.messageId) {
            const k = `${d.toJid}|${d.messageId}|${d.type}`;
            if (existingKeys.has(k)) continue;
            existingKeys.add(k);
        }
        if (!messagesByGroup[d.toJid]) messagesByGroup[d.toJid] = [];
        messagesByGroup[d.toJid].push(d);
    }
    if (activeJid) {
        rerenderActiveChat();
    }
    renderGroups();
});
socket.on('msg', (data) => {
    if (!data || !data.toJid) return;
    if (data.messageId) {
        const arr = messagesByGroup[data.toJid] || [];
        const dupKey = `${data.toJid}|${data.messageId}|${data.type}`;
        for (const m of arr) {
            if (m.messageId === data.messageId && m.type === data.type) return;
        }
        const exists = arr.some(m => `${m.toJid}|${m.messageId}|${m.type}` === dupKey);
        if (exists) return;
    }
    if (!messagesByGroup[data.toJid]) messagesByGroup[data.toJid] = [];
    messagesByGroup[data.toJid].push(data);
    if (data.toJid === activeJid || activeJid === ALL_CHAT_ID) {
        appendMessage(data);
        scrollToBottom();
    }
    renderGroups();
});
socket.on('reaction', ({ targetId, emoji, senderJid, senderName }) => {
    // 1. Atualiza na estrutura de dados local
    for (const groupJid of Object.keys(messagesByGroup)) {
        const msg = messagesByGroup[groupJid].find(m => m.messageId === targetId);
        if (msg) {
            if (!msg.reactions) msg.reactions = {};
            if (emoji) msg.reactions[senderJid] = emoji;
            else delete msg.reactions[senderJid];
            break;
        }
    }

    // 2. Atualiza em tempo real na interface se o elemento do balão existir
    const msgEl = document.querySelector(`[data-message-id="${targetId}"]`);
    if (msgEl) {
        let reactionsEl = msgEl.querySelector('.msg-reactions');
        let reactions = null;
        for (const groupJid of Object.keys(messagesByGroup)) {
            const msg = messagesByGroup[groupJid].find(m => m.messageId === targetId);
            if (msg) {
                reactions = msg.reactions;
                break;
            }
        }
        if (reactions && Object.keys(reactions).length > 0) {
            const html = renderReactions(reactions);
            if (reactionsEl) {
                reactionsEl.outerHTML = html;
            } else {
                msgEl.insertAdjacentHTML('beforeend', html);
            }
        } else if (reactionsEl) {
            reactionsEl.remove();
        }
    }
});
socket.on('connect', () => { statusEl.innerText = 'online'; statusEl.style.color = 'var(--wa-green)'; });
socket.on('disconnect', () => { statusEl.innerText = 'reconectando…'; statusEl.style.color = '#ff8182'; });

// Abrir direto no chat "Todos" ao carregar a página
selectAllChat();
