/* ============================================================
   BotSticker Dashboard - Cliente
   Layout 3 colunas: Chats | Mensagens | Estatísticas
   Mobile: telas únicas com tabbar inferior
   ============================================================ */

const socket = io();

const $ = (id) => document.getElementById(id);
const chat = $('chat');
const groupList = $('groupList');
const groupSearch = $('groupSearch');
const chatName = $('chatName');
const chatSub = $('chatSub');
const chatAvatar = $('chatAvatar');
const statusEl = $('status');
const soundChat = $('sound-chat');
const soundAction = $('sound-action');
const soundError = $('sound-error');
const notifBtn = $('notif-btn');
const pushBtn = $('push-btn');
const replyBar = $('replyBar');
const replyName = $('replyName');
const replyTextEl = $('replyText');
const attachmentsEl = $('attachments');
const messageInput = $('messageInput');
const sendBtn = $('sendBtn');
const fileInput = $('fileInput');
const composerEl = $('composer');
const toastEl = $('toast');
const backBtn = $('backBtn');
const mobileBackFromStats = $('mobileBackFromStats');
const openStatsMobile = $('openStatsMobile');
const toggleStatsPanel = $('toggleStatsPanel');
const colStats = $('colStats');
const mobileTabbar = $('mobileTabbar');

const ALL_CHAT_ID = '__all__';

let groups = [];
let activeJid = null;
let messagesByGroup = {};
let knownGroupJids = new Set();
let lastDate = "";
let soundEnabled = false, pushEnabled = false;
let currentReply = null, pendingAttachments = [];

// ======================= Util =======================

function playSound(audio) {
    if (!soundEnabled || !audio) return;
    try { audio.currentTime = 0; audio.play().catch(() => {}); } catch (_) {}
}

function showToast(msg, ms = 2200) {
    if (!toastEl) return;
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
            if (p === "granted") {
                pushEnabled = true; pushBtn.innerText = "PUSH ON"; pushBtn.classList.add('active');
            }
        });
    } else {
        pushEnabled = false; pushBtn.innerText = "PUSH"; pushBtn.classList.remove('active');
    }
    localStorage.setItem('wa_push', pushEnabled ? '1' : '0');
}

function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t === 'oled' ? 'dark' : t);
    localStorage.setItem('wa_theme', t);
}
setTheme(localStorage.getItem('wa_theme') || 'dark');
soundEnabled = localStorage.getItem('wa_sound') === '1';
if (soundEnabled) { notifBtn.innerText = 'SOM ON'; notifBtn.classList.add('active'); }
pushEnabled = localStorage.getItem('wa_push') === '1';
if (pushEnabled) { pushBtn.innerText = 'PUSH ON'; pushBtn.classList.add('active'); }

const scrollToBottom = () => setTimeout(() => { chat.scrollTop = chat.scrollHeight; }, 30);

function getUserColor(phone) {
    if (!phone) return 'var(--wa-green)';
    const colors = ['#3498db','#e74c3c','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#d35400','#c0392b','#27ae60','#2980b9','#8e44ad','#f39c12','#16a085'];
    let hash = 0;
    for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');

const detectMediaType = (file) => {
    const t = (file.type || '').toLowerCase();
    if (t === 'image/webp') return 'sticker';
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    return 'document';
};

const allowedSendTypes = (file) => {
    const t = (file.type || '').toLowerCase();
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
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
});

window.changeAttType = (i, type) => { pendingAttachments[i].sendType = type; pendingAttachments[i].type = type; renderAttachments(); };
window.removeAttachment = (i) => { pendingAttachments.splice(i, 1); renderAttachments(); };

function renderAttachments() {
    if (pendingAttachments.length === 0) {
        attachmentsEl.innerHTML = '';
        return;
    }
    attachmentsEl.innerHTML = pendingAttachments.map((att, i) => {
        const allowed = allowedSendTypes({ type: att.mime });
        const preview = (att.type === 'image' || att.type === 'sticker') ? `<img src="${att.previewUrl}" alt="">` :
                        (att.type === 'video') ? `<video src="${att.previewUrl}" muted></video>` :
                        (att.type === 'audio') ? '🎵' : '📎';
        const picker = allowed.length > 1 ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">${allowed.map(opt => `
            <button onclick="changeAttType(${i}, '${opt.id}')"
                    style="padding:2px 8px;font-size:11px;border-radius:999px;border:1px solid var(--border);
                           background:${att.sendType === opt.id ? 'var(--wa-green)' : 'var(--panel-2)'};
                           color:${att.sendType === opt.id ? '#00210e' : 'var(--text)'};
                           cursor:pointer;">${opt.label}</button>
        `).join('')}</div>` : '';
        const sizeKB = Math.round(att.dataBase64.length * 0.75 / 1024);
        return `
            <div class="attachment-chip" style="padding:4px 10px 6px;align-items:flex-start;">
                <div style="width:36px;height:36px;border-radius:6px;overflow:hidden;flex-shrink:0;background:var(--panel);display:flex;align-items:center;justify-content:center;">
                    ${preview}
                </div>
                <div style="min-width:0;flex:1;">
                    <div style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(att.fileName)}</div>
                    <div style="font-size:11px;color:var(--text-dim);">${att.mime} · ${sizeKB} KB</div>
                    ${picker}
                </div>
                <button onclick="removeAttachment(${i})" style="background:transparent;border:none;color:var(--text-dim);cursor:pointer;font-size:16px;">✕</button>
            </div>
        `;
    }).join('');
}

$('attachBtn').addEventListener('click', () => {
    if (!activeJid) return showToast('Selecione um grupo');
    fileInput.click();
});

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
            detectedType: detected,
            sendType, type: sendType,
            mime: f.type,
            fileName: f.name,
            previewUrl: dataUrl,
            ptt: detected === 'audio' && sendType === 'audio'
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
        const url = currentReply ? '/api/reply' : '/api/send';
        const body = currentReply ? {
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

// ======================= Render de mensagens =======================

function initialsFor(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return ((parts[0][0] || '') + (parts[1][0] || '')).toUpperCase();
}

function avatarHtml(group) {
    const subj = group?.subject || group?.jid?.split('@')[0] || '?';
    if (group?.pictureUrl) {
        return `<img class="group-avatar" src="${escapeHtml(group.pictureUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    }
    return `<div class="group-avatar">${escapeHtml(initialsFor(subj))}</div>`;
}

function groupNameForJid(jid) {
    const g = groups.find(x => x.jid === jid);
    return g?.subject || (jid ? jid.split('@')[0] : '');
}

function allMessages() {
    return Object.values(messagesByGroup).flat().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
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
    return `<div class="msg-reactions">${emojis.join('')}${count > 1 ? ` <span>${count}</span>` : ''}</div>`;
}

const quotedHtml = (q) => {
    const name = escapeHtml(q.name || (q.phone ? '@' + q.phone : 'Mensagem'));
    const inner = q.text ? `<div class="msg-quote-text">${escapeHtml(q.text)}</div>` : q.hasMedia ? `<div class="msg-quote-text">📎 Mídia</div>` : '';
    return `<div class="msg-quote"><div class="msg-quote-name">${name}</div>${inner}</div>`;
};

const mediaHtml = (media) => {
    if (!media) return '';
    if (media.type === 'image') return `<div class="msg-media"><img src="${escapeHtml(media.url)}" loading="lazy"></div>`;
    if (media.type === 'video') return `<div class="msg-media"><video src="${escapeHtml(media.url)}" controls></video></div>`;
    if (media.type === 'audio') return `<div class="msg-media"><audio src="${escapeHtml(media.url)}" controls></audio></div>`;
    if (media.type === 'sticker') return `<div class="msg-media"><img src="${escapeHtml(media.url)}" style="width:140px;height:140px;"></div>`;
    return '';
};

function appendMessage(data) {
    const dateStr = new Date(data.timestamp || Date.now()).toLocaleDateString();
    if (dateStr !== lastDate) {
        const label = dateStr === new Date().toLocaleDateString() ? 'Hoje' : dateStr;
        chat.insertAdjacentHTML('beforeend', `<div class="msg-day-sep">${escapeHtml(label)}</div>`);
        lastDate = dateStr;
    }

    const isSystem = data.type === 'action' || data.type === 'error';
    if (isSystem) {
        const cls = data.type === 'error' ? 'msg-error' : '';
        chat.insertAdjacentHTML('beforeend',
            `<div class="msg-system ${cls}">${escapeHtml(data.text || '')}</div>`);
        playSound(data.type === 'error' ? soundError : soundAction);
        if (pushEnabled && document.visibilityState !== 'visible') {
            try { new Notification(data.group || 'Bot', { body: data.text || '' }); } catch (_) {}
        }
        return;
    }

    const fromMe = !!data.fromMe;
    const wrapperCls = fromMe ? 'msg-wrapper from-me' : 'msg-wrapper from-other';
    const authorColor = fromMe ? '#ffd279' : getUserColor(data.phone);
    const quoted = data.quoted ? quotedHtml(data.quoted) : '';
    const media = mediaHtml(data.media);
    const reactions = renderReactions(data.reactions);
    const tag = data.type === 'viewonce'
        ? `<span style="background:rgba(255,165,0,0.25);color:#ff9f43;padding:0 6px;border-radius:4px;font-size:10.5px;font-weight:700;margin-left:6px;">VIEWONCE</span>`
        : '';

    chat.insertAdjacentHTML('beforeend', `
        <div class="${wrapperCls}">
            <div class="msg-bubble"
                 onclick="openReplyFor(this)"
                 data-to-jid="${data.toJid || ''}"
                 data-message-id="${data.messageId || ''}"
                 data-sender-jid="${data.senderJid || ''}"
                 data-from-me="${fromMe ? '1' : '0'}"
                 data-phone="${data.phone || ''}"
                 data-name="${escapeHtml(data.name || '')}"
                 data-preview="${escapeHtml(data.text || '')}"
                 data-has-media="${data.media ? '1' : '0'}">
                ${quoted}
                ${media}
                ${data.text ? `<div class="msg-text">${escapeHtml(data.text)}</div>` : ''}
                <div class="msg-meta">
                    <span class="msg-author" style="color:${authorColor}">
                        ${escapeHtml(data.name || 'Usuário')}${tag}
                    </span>
                    <span>${escapeHtml(data.time || new Date(data.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span>
                </div>
                ${reactions}
            </div>
        </div>
    `);

    playSound(soundChat);
    if (pushEnabled && document.visibilityState !== 'visible') {
        const title = activeJid === ALL_CHAT_ID ? (data.group || 'Nova mensagem') : (data.name || 'Nova mensagem');
        const body = (data.hidden || data.type === 'viewonce' ? '🔒 ' : '') + (data.text || (data.media ? 'Mídia' : ''));
        try { new Notification(title, { body }); } catch (_) {}
    }
}

function openReplyFor(el) {
    if (!activeJid) return showToast('Selecione um grupo');
    const toJid = el.dataset.toJid;
    if (toJid && !knownGroupJids.has(toJid)) return showToast('Grupo indisponível no dashboard');
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

// ======================= Lista de chats =======================

function renderGroups() {
    const filter = (groupSearch.value || '').toLowerCase().trim();
    const filtered = groups.filter(g => !filter || (g.subject || g.jid.split('@')[0]).toLowerCase().includes(filter));
    const allCount = allMessages().length;
    const allVisible = !filter;

    const items = [];

    items.push(`<li class="group-item ${activeJid === ALL_CHAT_ID ? 'active' : ''}" onclick="selectAllChat()">
        <div class="group-avatar" style="background:var(--wa-green);color:#00210e;font-weight:700;">T</div>
        <div class="group-meta">
            <div class="group-name">Todos</div>
            <div class="group-sub">${allCount} mensagem${allCount !== 1 ? 's' : ''}</div>
        </div>
        ${allCount > 0 ? '<div class="group-dot"></div>' : ''}
    </li>`);

    if (filtered.length === 0) {
        items.push(`<li class="empty">Nenhum grupo com dashboard ativa ainda.<br><small>Use <code>!dashboard</code> em um grupo para ativá-lo.</small></li>`);
    } else {
        for (const g of filtered) {
            const subj = g.subject || g.jid.split('@')[0];
            const count = (messagesByGroup[g.jid] || []).length;
            const recent = (messagesByGroup[g.jid] || []).slice(-1)[0];
            const isRecent = recent && (Date.now() - (recent.timestamp || 0) < 5 * 60 * 1000);
            const sub = recent ? (recent.text ? recent.text.slice(0, 40) : (recent.media ? '📎 Mídia' : `${count} mensagem${count !== 1 ? 's' : ''}`)) : `${count} mensagem${count !== 1 ? 's' : ''}`;
            items.push(`<li class="group-item ${g.jid === activeJid ? 'active' : ''}" onclick="selectGroup('${g.jid}')">
                ${avatarHtml(g)}
                <div class="group-meta">
                    <div class="group-name">${escapeHtml(subj)}</div>
                    <div class="group-sub">${escapeHtml(sub)}</div>
                </div>
                ${count > 0 ? `<div class="group-side">${isRecent ? '<div class="group-dot"></div>' : ''}<div class="group-badge">${count > 99 ? '99+' : count}</div></div>` : ''}
            </li>`);
        }
    }

    groupList.innerHTML = items.join('');
}

function setScreenMobile(name) {
    document.body.setAttribute('data-screen', name);
    if (!mobileTabbar) return;
    for (const btn of mobileTabbar.querySelectorAll('.mt-tab')) {
        btn.classList.toggle('active', btn.dataset.tab === name);
    }
}

window.selectAllChat = () => {
    activeJid = ALL_CHAT_ID;
    chatName.textContent = 'Todos os grupos';
    chatSub.textContent = 'Visão geral de todas as conversas';
    chatAvatar.innerHTML = '<div class="group-avatar" style="background:var(--wa-green);color:#00210e;">T</div>';
    clearReply();
    messageInput.disabled = false; sendBtn.disabled = false;
    document.getElementById('attachBtn').disabled = false;
    setScreenMobile('chat');
    rerenderActiveChat();
    renderGroups();
};

window.selectGroup = (jid) => {
    if (!jid || (knownGroupJids.size && !knownGroupJids.has(jid))) return showToast('Grupo indisponível no dashboard');
    activeJid = jid;
    const g = groups.find(x => x.jid === jid);
    const subj = g?.subject || jid.split('@')[0];
    chatName.textContent = subj;
    chatSub.textContent = jid.split('@')[0];
    if (g?.pictureUrl) {
        chatAvatar.innerHTML = `<img class="group-avatar" src="${escapeHtml(g.pictureUrl)}" alt="">`;
    } else {
        chatAvatar.innerHTML = `<div class="group-avatar">${escapeHtml(initialsFor(subj))}</div>`;
    }
    clearReply();
    messageInput.disabled = false; sendBtn.disabled = false;
    document.getElementById('attachBtn').disabled = false;
    setScreenMobile('chat');
    rerenderActiveChat();
    renderGroups();
};

groupSearch.addEventListener('input', renderGroups);

backBtn.addEventListener('click', () => {
    if (activeJid === ALL_CHAT_ID) {
        activeJid = null;
        setScreenMobile('chats');
    } else {
        activeJid = null;
        setScreenMobile('chats');
    }
    chatName.textContent = 'Selecione um grupo';
    chatSub.textContent = '—';
    chatAvatar.innerHTML = '<div class="group-avatar">?</div>';
    chat.innerHTML = '';
    renderGroups();
});

if (mobileBackFromStats) {
    mobileBackFromStats.addEventListener('click', () => {
        if (activeJid) setScreenMobile('chat');
        else setScreenMobile('chats');
    });
}

if (openStatsMobile) {
    openStatsMobile.addEventListener('click', () => setScreenMobile('stats'));
}

if (toggleStatsPanel) {
    toggleStatsPanel.addEventListener('click', () => {
        colStats.classList.toggle('collapsed');
        toggleStatsPanel.textContent = colStats.classList.contains('collapsed') ? '«' : '»';
    });
}

if (mobileTabbar) {
    for (const btn of mobileTabbar.querySelectorAll('.mt-tab')) {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab === 'chats') {
                activeJid = null;
                setScreenMobile('chats');
                chat.innerHTML = '';
                renderGroups();
            } else if (tab === 'chat') {
                if (activeJid) setScreenMobile('chat');
                else { activeJid = ALL_CHAT_ID; chatName.textContent = 'Todos'; rerenderActiveChat(); setScreenMobile('chat'); renderGroups(); }
            } else if (tab === 'stats') {
                setScreenMobile('stats');
                refreshSystem();
            }
        });
    }
}

// ======================= Socket =======================

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
    const seen = new Set();
    for (const jid of Object.keys(messagesByGroup)) {
        for (const m of messagesByGroup[jid]) {
            if (m.messageId) seen.add(`${m.toJid}|${m.messageId}|${m.type}`);
        }
    }
    for (const d of incoming) {
        if (!d || !d.toJid) continue;
        if (d.messageId) {
            const k = `${d.toJid}|${d.messageId}|${d.type}`;
            if (seen.has(k)) continue;
            seen.add(k);
        }
        if (!messagesByGroup[d.toJid]) messagesByGroup[d.toJid] = [];
        messagesByGroup[d.toJid].push(d);
    }
    if (activeJid) rerenderActiveChat();
    renderGroups();
});

socket.on('msg', (data) => {
    if (!data || !data.toJid) return;
    if (data.messageId) {
        const arr = messagesByGroup[data.toJid] || [];
        const dupKey = `${data.toJid}|${data.messageId}|${data.type}`;
        if (arr.some(m => `${m.toJid}|${m.messageId}|${m.type}` === dupKey)) return;
    }
    if (!messagesByGroup[data.toJid]) messagesByGroup[data.toJid] = [];
    messagesByGroup[data.toJid].push(data);
    if (data.toJid === activeJid || activeJid === ALL_CHAT_ID) {
        appendMessage(data);
        scrollToBottom();
    }
    renderGroups();
});

socket.on('reaction', ({ targetId, emoji }) => {
    for (const jid of Object.keys(messagesByGroup)) {
        const msg = messagesByGroup[jid].find(m => m.messageId === targetId);
        if (msg) {
            if (!msg.reactions) msg.reactions = {};
            if (emoji) msg.reactions[arguments[0].senderJid || ''] = emoji;
            else for (const k of Object.keys(msg.reactions)) delete msg.reactions[k];
            break;
        }
    }
    const el = document.querySelector(`[data-message-id="${targetId}"]`);
    if (el) {
        let rx = el.querySelector('.msg-reactions');
        if (rx) rx.remove();
    }
});

socket.on('connect', () => { statusEl.innerText = 'online'; statusEl.style.color = 'var(--wa-green)'; });
socket.on('disconnect', () => { statusEl.innerText = 'reconectando…'; statusEl.style.color = '#ff8182'; });

socket.on('reset', () => {
    messagesByGroup = {};
    lastDate = '';
    chat.innerHTML = '';
    if (activeJid) rerenderActiveChat();
    renderGroups();
    showToast('🧹 Dashboard resetado pelo dono');
});

// ======================= Painel de estatísticas =======================

const sysEls = {
    state: $('sysBotState'),
    pid: $('sysPid'),
    restarts: $('sysRestarts'),
    commands: $('sysCommands'),
    cpuBar: $('cpuBar'),
    cpuLabel: $('cpuLabel'),
    cpuMeta: $('cpuMeta'),
    ramBar: $('ramBar'),
    ramLabel: $('ramLabel'),
    ramMeta: $('ramMeta'),
    procRss: $('procRss'),
    procHeap: $('procHeap'),
    node: $('sysNode'),
    platform: $('sysPlatform'),
    uptime: $('sysUptime'),
    groupsTotal: $('sysGroupsTotal'),
    groupsActive: $('sysGroupsActive'),
    groupsPartial: $('sysGroupsPartial'),
    logs: $('sysLogs')
};

function fmtBytesShort(n) {
    if (!n && n !== 0) return '—';
    const u = ['B','KB','MB','GB','TB'];
    let i = 0; let v = Number(n);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function setBar(barEl, labelEl, pct, labelText) {
    if (!barEl) return;
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    barEl.style.width = v.toFixed(1) + '%';
    barEl.style.background = v > 85 ? 'linear-gradient(90deg, var(--error), #ffb84d)'
                          : v > 65 ? 'linear-gradient(90deg, var(--warn), var(--wa-teal))'
                          : 'linear-gradient(90deg, var(--wa-green), var(--wa-teal))';
    if (labelEl) labelEl.textContent = labelText;
}

async function refreshSystem() {
    try {
        const res = await fetch('/api/system', { cache: 'no-store' });
        const d = await res.json();
        if (!res.ok || !d.ok) throw new Error(d.error || 'falha');

        if (sysEls.state) sysEls.state.textContent = d.bot.connected ? '✅ Conectado' : '❌ Desconectado';
        if (sysEls.pid) sysEls.pid.textContent = String(d.pid);
        if (sysEls.restarts) sysEls.restarts.textContent = String(d.bot.totalRestarts || 0);
        if (sysEls.commands) sysEls.commands.textContent = (d.bot.totalCommands || 0).toLocaleString('pt-BR');

        const cpuPct = d.cpu.userPct || 0;
        setBar(sysEls.cpuBar, sysEls.cpuLabel,
            cpuPct,
            `${cpuPct.toFixed(1)}% • ${d.cpus || d.cpu.cores || 0} cores`);
        if (sysEls.cpuMeta) sysEls.cpuMeta.textContent = `${d.cpuModel || ''}`.slice(0, 64);

        const ramPct = d.memory.usedPct || 0;
        setBar(sysEls.ramBar, sysEls.ramLabel,
            ramPct,
            `${ramPct.toFixed(1)}% • ${fmtBytesShort(d.memory.usedBytes)} / ${fmtBytesShort(d.memory.totalBytes)}`);
        if (sysEls.ramMeta) sysEls.ramMeta.textContent = `Livre: ${fmtBytesShort(d.memory.freeBytes)}`;

        if (sysEls.procRss) sysEls.procRss.textContent = fmtBytesShort(d.process.rssBytes);
        if (sysEls.procHeap) sysEls.procHeap.textContent = `${fmtBytesShort(d.process.heapUsedBytes)} / ${fmtBytesShort(d.process.heapTotalBytes)}`;
        if (sysEls.node) sysEls.node.textContent = d.nodeVersion || '—';
        if (sysEls.platform) sysEls.platform.textContent = `${d.platform} (${d.arch})`;

        if (sysEls.uptime) sysEls.uptime.textContent = d.uptimeStr || '—';

        if (sysEls.groupsTotal) sysEls.groupsTotal.textContent = String(d.bot.totalGroups || 0);
        if (sysEls.groupsActive) sysEls.groupsActive.textContent = String(d.bot.activeGroups || 0);
        if (sysEls.groupsPartial) sysEls.groupsPartial.textContent = String(d.bot.partialGroups || 0);

        renderSystemLogs();
    } catch (e) {
        if (sysEls.state) sysEls.state.textContent = 'erro: ' + (e.message || e);
    }
}

function renderSystemLogs() {
    if (!sysEls.logs) return;
    const recent = allMessages().slice(-30).reverse();
    if (recent.length === 0) {
        sysEls.logs.innerHTML = '<div style="opacity:0.7;">Sem mensagens registradas ainda.</div>';
        return;
    }
    sysEls.logs.innerHTML = recent.map(m => {
        const tag = m.type === 'error' ? 'error' : (m.type === 'action' ? 'action' : (m.fromMe ? 'system' : ''));
        const tagLabel = tag ? tag.toUpperCase() : (m.fromMe ? 'BOT' : 'CHAT');
        const time = m.time || new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const txt = (m.text || (m.media ? `[${m.media.type || 'mídia'}]` : '')).slice(0, 80);
        const who = m.name || (m.fromMe ? 'Você' : '');
        return `<div class="log-line">
            <span class="log-time">${escapeHtml(time)}</span>
            ${tag ? `<span class="log-tag ${tag}">${escapeHtml(tagLabel)}</span>` : ''}
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${who ? `<b>${escapeHtml(who)}:</b> ` : ''}${escapeHtml(txt)}</span>
        </div>`;
    }).join('');
}

setInterval(refreshSystem, 3000);
refreshSystem();

// Inicial
setScreenMobile('chats');
renderGroups();
selectAllChat();
