/* Dashboard client — enxuto: 3 colunas, mobile telas únicas, system stats */
const $=id=>document.getElementById(id);
const socket=io();
const chat=$('chat'),groupList=$('groupList'),groupSearch=$('groupSearch'),
chatName=$('chatName'),chatSub=$('chatSub'),chatAvatar=$('chatAvatar'),
statusEl=$('status'),soundChat=$('sound-chat'),soundAction=$('sound-action'),soundError=$('sound-error'),
notifBtn=$('notif-btn'),pushBtn=$('push-btn'),replyBar=$('replyBar'),
replyName=$('replyName'),replyTextEl=$('replyText'),
attachmentsEl=$('attachments'),messageInput=$('messageInput'),
sendBtn=$('sendBtn'),fileInput=$('fileInput'),composerEl=$('composer'),
toastEl=$('toast'),backBtn=$('backBtn'),
mobileBackFromStats=$('mobileBackFromStats'),openStatsMobile=$('openStatsMobile'),colStats=$('colStats'),mobileTabbar=$('mobileTabbar');

const ALL='__all__';
let groups=[],activeJid=null,msgsByJid={},lastDate='',currentReply=null,pendingAttachments=[];
let soundEnabled=localStorage.getItem('wa_sound')==='1';
let pushEnabled=localStorage.getItem('wa_push')==='1';

/* ========== Util ========== */
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
function initials(n){const p=String(n||'?').trim().split(/\s+/);return p.length===1?p[0].slice(0,2).toUpperCase():(p[0][0]||'')+(p[1][0]||'')}
function userColor(ph){if(!ph)return'var(--g)';const c=['#3498db','#e74c3c','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#d35400','#c0392b','#27ae60','#2980b9','#8e44ad','#f39c12','#16a085'];let h=0;for(let i=0;i<ph.length;i++)h=ph.charCodeAt(i)+((h<<5)-h);return c[Math.abs(h)%c.length]}
function toast(m,ms=2200){toastEl.textContent=m;toastEl.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>toastEl.classList.remove('show'),ms)}
function play(a){if(soundEnabled&&a)try{a.currentTime=0;a.play().catch(()=>{})}catch(_){}}

/* ========== Som / push (tema único: OLED Windows Terminal) ========== */
document.documentElement.setAttribute('data-theme','oled');
if(soundEnabled){notifBtn.innerText='SOM ON';notifBtn.classList.add('active')}
if(pushEnabled){pushBtn.innerText='PUSH ON';pushBtn.classList.add('active')}
window.toggleSound=()=>{soundEnabled=!soundEnabled;notifBtn.innerText=soundEnabled?'SOM ON':'SOM';notifBtn.classList.toggle('active',soundEnabled);if(soundEnabled)play(soundChat);localStorage.setItem('wa_sound',soundEnabled?'1':'0')};
window.togglePush=()=>{if(!pushEnabled){if(!('Notification'in window))return alert('Sem suporte a notificações.');Notification.requestPermission().then(p=>{if(p==='granted'){pushEnabled=true;pushBtn.innerText='PUSH ON';pushBtn.classList.add('active')}})}else{pushEnabled=false;pushBtn.innerText='PUSH';pushBtn.classList.remove('active')}localStorage.setItem('wa_push',pushEnabled?'1':'0')};

/* ========== Anexos ========== */
function detectType(f){const t=(f.type||'').toLowerCase();return t==='image/webp'?'sticker':t.startsWith('image/')?'image':t.startsWith('video/')?'video':t.startsWith('audio/')?'audio':'document'}
function allowedTypes(f){const t=(f.type||'').toLowerCase();if(t.startsWith('image/'))return[{id:'image',l:'📷 Imagem'},{id:'sticker',l:'🏷️ Sticker'}];if(t.startsWith('video/'))return[{id:'video',l:'🎥 Vídeo'}];if(t.startsWith('audio/'))return[{id:'audio',l:'🎵 Áudio'}];return[{id:'document',l:'📎 Documento'}]}
function resizeImg(f){return new Promise(r=>{if(!f.type.startsWith('image/')||f.type==='image/gif')return r(f);const rd=new FileReader();rd.onload=e=>{const img=new Image();img.onload=()=>{const M=1200;let w=img.width,h=img.height;if(w>M||h>M){if(w>h){h=Math.round(h*M/w);w=M}else{w=Math.round(w*M/h);h=M}const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(img,0,0,w,h);cv.toBlob(b=>r(b?new File([b],f.name,{type:'image/jpeg',lastModified:Date.now()}):f),'image/jpeg',.8)}else r(f)};img.onerror=()=>r(f);img.src=e.target.result};rd.onerror=()=>r(f);rd.readAsDataURL(f)})}
function fileToUrl(f){return new Promise((r,j)=>{const rd=new FileReader();rd.onload=()=>r(rd.result);rd.onerror=j;rd.readAsDataURL(f)})}
window.changeAttType=(i,t)=>{pendingAttachments[i].sendType=t;pendingAttachments[i].type=t;renderAtts()};
window.removeAtt=(i)=>{pendingAttachments.splice(i,1);renderAtts()};
function renderAtts(){if(!pendingAttachments.length){attachmentsEl.innerHTML='';return}attachmentsEl.innerHTML=pendingAttachments.map((a,i)=>{const prev=a.type==='image'||a.type==='sticker'?`<img src="${a.previewUrl}">`:a.type==='video'?`<video src="${a.previewUrl}" muted></video>`:a.type==='audio'?'🎵':'📎';const opt=allowedTypes({type:a.mime}).map(o=>`<button onclick="changeAttType(${i},'${o.id}')" style="padding:2px 8px;font-size:11px;border-radius:999px;border:1px solid var(--b);background:${a.sendType===o.id?'var(--g)':'var(--pn2)'};color:${a.sendType===o.id?'#00210e':'var(--tx)'};cursor:pointer;">${o.l}</button>`).join('');const kb=Math.round(a.dataBase64.length*.75/1024);return`<div style="display:flex;gap:8px;padding:4px 10px 6px;align-items:flex-start;background:var(--pn2);border-radius:8px;"><div style="width:36px;height:36px;border-radius:6px;overflow:hidden;background:var(--pn);display:flex;align-items:center;justify-content:center;">${prev}</div><div style="flex:1;min-width:0;"><div style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.fileName)}</div><div style="font-size:11px;color:var(--dm);">${a.mime} · ${kb} KB</div><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;">${opt}</div></div><button onclick="removeAtt(${i})" style="background:transparent;border:none;color:var(--dm);cursor:pointer;font-size:16px;">✕</button></div>`}).join('')}
$('attachBtn').addEventListener('click',()=>{if(!activeJid)return toast('Selecione um grupo');fileInput.click()});
fileInput.addEventListener('change',async()=>{for(let f of Array.from(fileInput.files||[])){if(f.size>16*1024*1024){toast('Arquivo > 16MB');continue}f=await resizeImg(f);const det=detectType(f),opt=allowedTypes({type:f.type}),st=opt[0]?opt[0].id:det,dU=await fileToUrl(f);pendingAttachments.push({dataBase64:dU.split(',')[1],detectedType:det,sendType:st,type:st,mime:f.type,fileName:f.name,previewUrl:dU,ptt:det==='audio'&&st==='audio'})}fileInput.value='';renderAtts()});
const autoSize=()=>{messageInput.style.height='auto';messageInput.style.height=Math.min(messageInput.scrollHeight,120)+'px'};
messageInput.addEventListener('input',autoSize);

/* ========== Reply / Send ========== */
function setReply(t){currentReply=t;if(!t)return replyBar.classList.remove('show');replyName.textContent=t.name||(t.phone?'@'+t.phone:'Mensagem');replyTextEl.textContent=t.preview||(t.hasMedia?'📎 Mídia':'');replyBar.classList.add('show')}
window.clearReply=()=>{currentReply=null;replyBar.classList.remove('show')};
async function sendCurrent(){if(!activeJid)return toast('Selecione um grupo');const tj=currentReply?.toJid||activeJid;if(tj===ALL)return toast('Responda uma mensagem ou selecione um grupo');const text=messageInput.value.trim();if(!text&&!pendingAttachments.length)return toast('Digite ou anexe algo');sendBtn.disabled=true;try{const url=currentReply?'/api/reply':'/api/send';const body=currentReply?{toJid:tj,text:text||'',quotedId:currentReply.messageId,quotedParticipant:currentReply.senderJid,quotedFromMe:currentReply.fromMe,quotedText:currentReply.preview||''}:{toJid:tj,text:text||''};if(pendingAttachments.length)body.media=pendingAttachments[0];const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=(r.headers.get('content-type')||'').includes('application/json')?await r.json():{ok:false};if(j.ok){toast('✅ Enviado');messageInput.value='';autoSize();pendingAttachments=[];renderAtts();clearReply()}else toast('❌ '+(j.error||'falha'))}catch(e){toast('❌ '+e.message)}finally{sendBtn.disabled=false}}
messageInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendCurrent()}});

/* ========== Render mensagens ========== */
function avatar(g){const s=g?.subject||g?.jid?.split('@')[0]||'?';return g?.pictureUrl?`<img class="group-avatar" src="${esc(g.pictureUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<div class="group-avatar">${esc(initials(s))}</div>`}
function allMsgs(){return Object.values(msgsByJid).flat().sort((a,b)=>(a.timestamp||0)-(b.timestamp||0))}
function rerender(){if(!activeJid)return;lastDate='';chat.innerHTML='';(activeJid===ALL?allMsgs():(msgsByJid[activeJid]||[])).forEach(append);setTimeout(()=>{chat.scrollTop=chat.scrollHeight},30)}
function reactionsHtml(rx){if(!rx||!Object.keys(rx).length)return'';const em=Array.from(new Set(Object.values(rx))),n=Object.keys(rx).length;return`<div class="msg-reactions">${em.join('')}${n>1?` <span>${n}</span>`:''}</div>`}
function quotedHtml(q){const n=esc(q.name||(q.phone?'@'+q.phone:'Mensagem'));const inn=q.text?`<div class="msg-quote-text">${esc(q.text)}</div>`:q.hasMedia?`<div class="msg-quote-text">📎 Mídia</div>`:'';return`<div class="msg-quote"><div class="msg-quote-name">${n}</div>${inn}</div>`}
function mediaHtml(m){if(!m)return'';if(m.type==='image')return`<div class="msg-media"><img src="${esc(m.url)}" loading="lazy"></div>`;if(m.type==='video')return`<div class="msg-media"><video src="${esc(m.url)}" controls></video></div>`;if(m.type==='audio')return`<div class="msg-media"><audio src="${esc(m.url)}" controls></audio></div>`;if(m.type==='sticker')return`<div class="msg-media"><img src="${esc(m.url)}" style="width:140px;height:140px;"></div>`;return''}
function msgHtml(d){const ds=new Date(d.timestamp||Date.now()).toLocaleDateString();let daySep='';if(ds!==lastDate){daySep=`<div class="msg-day-sep">${esc(ds===new Date().toLocaleDateString()?'Hoje':ds)}</div>`;lastDate=ds}if(d.type==='action'||d.type==='error'){play(d.type==='error'?soundError:soundAction);return daySep+`<div class="msg-system ${d.type==='error'?'msg-error':''}">${esc(d.text||'')}</div>`}const me=!!d.fromMe;const ac=me?'#ffd279':userColor(d.phone);const q=d.quoted?quotedHtml(d.quoted):'';const m=mediaHtml(d.media);const rx=reactionsHtml(d.reactions);return daySep+`<div class="msg-wrapper ${me?'from-me':'from-other'}"><div class="msg-bubble" onclick="openReply(this)" data-tj="${d.toJid||''}" data-mid="${d.messageId||''}" data-sj="${d.senderJid||''}" data-fm="${me?1:0}" data-ph="${d.phone||''}" data-nm="${esc(d.name||'')}" data-pv="${esc(d.text||'')}" data-hm="${d.media?1:0}">${q}${m}${d.text?`<div class="msg-text">${esc(d.text)}</div>`:''}<div class="msg-meta"><span class="msg-author" style="color:${ac}">${esc(d.name||'Usuário')}</span><span>${esc(d.time||new Date(d.timestamp||Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</span></div>${rx}</div></div>`}
function append(d){chat.insertAdjacentHTML('beforeend',msgHtml(d));play(soundChat)}
function rerenderBatch(){if(!activeJid)return;lastDate='';chat.innerHTML='';const list=activeJid===ALL?allMsgs():(msgsByJid[activeJid]||[]);if(!list.length)return;const frag=[];for(const d of list)frag.push(msgHtml(d));chat.insertAdjacentHTML('beforeend',frag.join(''));setTimeout(()=>{chat.scrollTop=chat.scrollHeight},30);if(soundEnabled)play(soundChat)}
window.openReply=el=>{if(!activeJid)return toast('Selecione um grupo');const tj=el.dataset.tj;if(!tj)return toast('Sem identificação de destino');setReply({toJid:tj,messageId:el.dataset.mid,senderJid:el.dataset.sj,fromMe:el.dataset.fm==='1',phone:el.dataset.ph,name:el.dataset.nm,preview:el.dataset.pv||(el.dataset.hm==='1'?'📎 Mídia':''),hasMedia:el.dataset.hm==='1'});messageInput.focus()};

/* ========== Lista de chats ========== */
function renderGroups(){
    const f=(groupSearch.value||'').toLowerCase().trim();
    const filtered=groups.filter(g=>!f||(g.subject||g.jid.split('@')[0]).toLowerCase().includes(f));
    let ac=0;for(const j of Object.keys(msgsByJid))ac+=(msgsByJid[j]||[]).length;
    const frag=document.createDocumentFragment();
    const all=document.createElement('li');
    all.className='group-item'+(activeJid===ALL?' active':'');
    all.innerHTML=`<div class="group-avatar" style="background:var(--g);color:#00210e;">T</div><div class="group-meta"><div class="group-name">Todos</div><div class="group-sub">${ac} mensagem${ac!==1?'s':''}</div></div>${ac?`<div class="group-side"><div class="group-dot"></div><div class="group-badge">${ac>99?'99+':ac}</div></div>`:''}`;
    all.onclick=()=>selAll();
    frag.appendChild(all);
    if(!filtered.length){const e=document.createElement('li');e.className='empty';e.innerHTML='Nenhum grupo com dashboard ativa ainda.<br><small>Use <code>!dashboard</code> em um grupo para ativá-lo.</small>';frag.appendChild(e)}
    else for(const g of filtered){const s=g.subject||g.jid.split('@')[0];const arr=msgsByJid[g.jid]||[];const c=arr.length;const r=arr.slice(-1)[0];const rec=r&&(Date.now()-(r.timestamp||0)<5*60*1000);const sub=r?(r.text?r.text.slice(0,40):(r.media?'📎 Mídia':`${c} mensagem${c!==1?'s':''}`)):`${c} mensagem${c!==1?'s':''}`;const li=document.createElement('li');li.className='group-item'+(g.jid===activeJid?' active':'');li.innerHTML=`${avatar(g)}<div class="group-meta"><div class="group-name">${esc(s)}</div><div class="group-sub">${esc(sub)}</div></div>${c?`<div class="group-side">${rec?'<div class="group-dot"></div>':''}<div class="group-badge">${c>99?'99+':c}</div></div>`:''}`;li.onclick=()=>selG(g.jid);frag.appendChild(li)}
    groupList.innerHTML='';
    groupList.appendChild(frag);
}
function setScreen(n){document.body.setAttribute('data-screen',n);if(mobileTabbar)for(const b of mobileTabbar.querySelectorAll('.mt-tab'))b.classList.toggle('active',b.dataset.tab===n)}
window.selAll=()=>{activeJid=ALL;chatName.textContent='Todos os grupos';chatSub.textContent='Visão geral de todas as conversas';chatAvatar.innerHTML='<div class="group-avatar" style="background:var(--g);color:#00210e;">T</div>';clearReply();messageInput.disabled=sendBtn.disabled=false;$('attachBtn').disabled=false;setScreen('chat');rerenderBatch();renderGroups()};
window.selG=jid=>{if(!jid)return;activeJid=jid;const g=groups.find(x=>x.jid===jid);const s=g?.subject||jid.split('@')[0];chatName.textContent=s;chatSub.textContent=jid.split('@')[0];chatAvatar.innerHTML=g?.pictureUrl?`<img class="group-avatar" src="${esc(g.pictureUrl)}">`:`<div class="group-avatar">${esc(initials(s))}</div>`;clearReply();messageInput.disabled=sendBtn.disabled=false;$('attachBtn').disabled=false;setScreen('chat');rerenderBatch();renderGroups()};
groupSearch.addEventListener('input',renderGroups);
backBtn.addEventListener('click',()=>{activeJid=null;setScreen('chats');chatName.textContent='Selecione um grupo';chatSub.textContent='—';chatAvatar.innerHTML='<div class="group-avatar">?</div>';chat.innerHTML='';renderGroups()});
if(mobileBackFromStats)mobileBackFromStats.addEventListener('click',()=>setScreen(activeJid?'chat':'chats'));
if(openStatsMobile)openStatsMobile.addEventListener('click',()=>{setScreen('stats');refreshSys()});

if(mobileTabbar)for(const b of mobileTabbar.querySelectorAll('.mt-tab'))b.addEventListener('click',()=>{const t=b.dataset.tab;if(t==='chats'){activeJid=null;setScreen('chats');chat.innerHTML='';renderGroups()}else if(t==='chat'){if(!activeJid){activeJid=ALL;chatName.textContent='Todos';rerenderBatch();renderGroups()}setScreen('chat')}else if(t==='stats'){setScreen('stats');refreshSys()}});

/* ========== Socket ========== */
socket.on('groups',list=>{groups=Array.isArray(list)?list:[];if(activeJid&&activeJid!==ALL&&groups.length&&!groups.find(g=>g.jid===activeJid))selAll();renderGroups()});
socket.on('history',h=>{const seen=new Set();for(const j of Object.keys(msgsByJid))for(const m of msgsByJid[j])if(m.messageId)seen.add(`${m.toJid}|${m.messageId}|${m.type}`);for(const d of(h||[])){if(!d?.toJid)continue;if(d.messageId){const k=`${d.toJid}|${d.messageId}|${d.type}`;if(seen.has(k))continue;seen.add(k)}(msgsByJid[d.toJid]=msgsByJid[d.toJid]||[]).push(d)}if(activeJid){rerenderBatch();}renderGroups()});
socket.on('msg',d=>{if(!d?.toJid)return;if(d.messageId){const k=`${d.toJid}|${d.messageId}|${d.type}`;if((msgsByJid[d.toJid]||[]).some(m=>`${m.toJid}|${m.messageId}|${m.type}`===k))return}(msgsByJid[d.toJid]=msgsByJid[d.toJid]||[]).push(d);if(d.toJid===activeJid||activeJid===ALL){append(d);setTimeout(()=>{chat.scrollTop=chat.scrollHeight},30)}renderGroups()});
socket.on('reaction',({targetId})=>{const el=document.querySelector(`[data-mid="${targetId}"]`);if(el){const r=el.querySelector('.msg-reactions');if(r)r.remove()}});
socket.on('connect',()=>{statusEl.innerText='online';statusEl.style.color='var(--g)'});
socket.on('disconnect',()=>{statusEl.innerText='reconectando…';statusEl.style.color='#ff8182'});
socket.on('reset',()=>{msgsByJid={};lastDate='';chat.innerHTML='';if(activeJid)rerender();renderGroups();toast('🧹 Dashboard resetado')});

/* ========== Painel de estatísticas ========== */
const sysEls={state:$('sysBotState'),pid:$('sysPid'),restarts:$('sysRestarts'),commands:$('sysCommands'),cpuBar:$('cpuBar'),cpuLabel:$('cpuLabel'),cpuMeta:$('cpuMeta'),ramBar:$('ramBar'),ramLabel:$('ramLabel'),ramMeta:$('ramMeta'),procRss:$('procRss'),procHeap:$('procHeap'),node:$('sysNode'),plat:$('sysPlatform'),uptime:$('sysUptime'),gTotal:$('sysGroupsTotal'),gActive:$('sysGroupsActive'),gPartial:$('sysGroupsPartial'),logs:$('sysLogs')};
function fmtB(n){if(!n&&n!==0)return'—';const u=['B','KB','MB','GB','TB'];let i=0,v=+n;while(v>=1024&&i<u.length-1){v/=1024;i++}return`${v.toFixed(v>=10||i===0?0:1)} ${u[i]}`}
function setBar(b,l,p,txt){if(!b)return;const v=Math.max(0,Math.min(100,+p||0));b.style.width=v.toFixed(1)+'%';b.style.background=v>85?'linear-gradient(90deg,var(--er),#ffb84d)':v>65?'linear-gradient(90deg,var(--w),var(--t))':'linear-gradient(90deg,var(--g),var(--t))';if(l)l.textContent=txt}
function renderLogs(){if(!sysEls.logs)return;const r=allMsgs().slice(-30).reverse();if(!r.length){sysEls.logs.innerHTML='<div style="opacity:.7">Sem mensagens ainda.</div>';return}sysEls.logs.innerHTML=r.map(m=>{const tag=m.type==='error'?'error':(m.type==='action'?'action':(m.fromMe?'system':''));const tl=tag?tag.toUpperCase():(m.fromMe?'BOT':'CHAT');const tm=m.time||new Date(m.timestamp||Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});const tx=(m.text||(m.media?`[${m.media.type||'mídia'}]`:'')).slice(0,160);const w=m.name||(m.fromMe?'Você':'');return`<div class="log-line"><span class="log-time">${esc(tm)}</span>${tag?`<span class="log-tag ${tag}">${esc(tl)}</span>`:''}<span style="flex:1 1 100%;min-width:0;overflow-wrap:anywhere;word-break:break-word;">${w?`<b>${esc(w)}:</b> `:''}${esc(tx)}</span></div>`}).join('')}
async function refreshSys(){try{const r=await fetch('/api/system',{cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'falha');if(sysEls.state)sysEls.state.textContent=d.bot.connected?'✅ Conectado':'❌ Desconectado';if(sysEls.pid)sysEls.pid.textContent=String(d.pid);if(sysEls.restarts)sysEls.restarts.textContent=String(d.bot.totalRestarts||0);if(sysEls.commands)sysEls.commands.textContent=(d.bot.totalCommands||0).toLocaleString('pt-BR');const cp=d.cpu.userPct||0;setBar(sysEls.cpuBar,sysEls.cpuLabel,cp,`${cp.toFixed(1)}% • ${d.cpus||0} cores`);if(sysEls.cpuMeta)sysEls.cpuMeta.textContent=(d.cpuModel||'').slice(0,64);const rp=d.memory.usedPct||0;setBar(sysEls.ramBar,sysEls.ramLabel,rp,`${rp.toFixed(1)}% • ${fmtB(d.memory.usedBytes)} / ${fmtB(d.memory.totalBytes)}`);if(sysEls.ramMeta)sysEls.ramMeta.textContent=`Livre: ${fmtB(d.memory.freeBytes)}`;if(sysEls.procRss)sysEls.procRss.textContent=fmtB(d.process.rssBytes);if(sysEls.procHeap)sysEls.procHeap.textContent=`${fmtB(d.process.heapUsedBytes)} / ${fmtB(d.process.heapTotalBytes)}`;if(sysEls.node)sysEls.node.textContent=d.nodeVersion||'—';if(sysEls.plat)sysEls.plat.textContent=`${d.platform} (${d.arch})`;if(sysEls.uptime)sysEls.uptime.textContent=d.uptimeStr||'—';if(sysEls.gTotal)sysEls.gTotal.textContent=String(d.bot.totalGroups||0);if(sysEls.gActive)sysEls.gActive.textContent=String(d.bot.activeGroups||0);if(sysEls.gPartial)sysEls.gPartial.textContent=String(d.bot.partialGroups||0);renderLogs()}catch(e){if(sysEls.state)sysEls.state.textContent='erro: '+(e.message||e)}}
setInterval(refreshSys,3000);refreshSys();

/* Init */
setScreen('chats');renderGroups();
