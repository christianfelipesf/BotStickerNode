const { isDashboardEnabled, getDashboardGroupInfo, upsertDashboardGroupInfo, groupMetadataCached, clearGroupMetadataCache, isBlacklisted, botIsAdmin, recordModEvent, getGroupData, getThemeForJid } = require('../database/utils');
const { getTheme } = require('../services/themes');
const { generateWelcomeImage, getUserAvatarBuffer, getGroupAvatarBuffer } = require('../services/welcomeImage');
const dashboard = require('../dashboard/dashboard');

const safeDashboardLog = (...args) => { try { dashboard.log(...args); } catch (_) {} };
const safeRemember = (...args) => { try { dashboard.rememberGroupInfo(...args); } catch (_) {} };

// Último título/descrição conhecidos por grupo — anti-spam do groups.update,
// que costuma repetir subject/desc mesmo sem mudança real.
const _groupSnapshot = new Map(); // jid -> { subject: string|null, desc: string|null }

function snapshotGroup(jid, meta) {
    try {
        if (!jid || !meta) return;
        const prev = _groupSnapshot.get(jid) || {};
        _groupSnapshot.set(jid, {
            subject: typeof meta.subject === 'string' ? meta.subject : (prev.subject ?? null),
            desc: typeof meta.desc === 'string' ? meta.desc : (prev.desc ?? null)
        });
    } catch (_) {}
}

function displayNameFor(p) {
    const digits = String(p || '').split('@')[0].split(':')[0];
    return /^\d{8,15}$/.test(digits) ? `@${digits}` : 'Membro';
}

async function resolveTheme(groupJid) {
    try {
        const themeId = (typeof getThemeForJid === 'function' ? getThemeForJid(groupJid) : 'default');
        return getTheme(themeId);
    } catch (_) { return null; }
}

async function sendEventCard(sock, { groupJid, mode, userJid, defaultMsg, customMsg, subject, memberCount, theme, groupAvatarRaw, fetchUserAvatar }) {
    const msg = (customMsg || '').toString().trim() || defaultMsg;
    const text = msg.split('@user').join(`@${String(userJid).split('@')[0]}`).split('{grupo}').join(subject);
    try {
        const userName = displayNameFor(userJid);
        const avatarRaw = fetchUserAvatar ? await getUserAvatarBuffer(sock, userJid, groupJid, groupMetadataCached).catch(() => null) : null;
        const card = await generateWelcomeImage({
            mode,
            userName,
            groupName: subject,
            memberCount,
            message: text.replace(/@\d+/g, '').trim(),
            avatarRaw,
            groupAvatarRaw: groupAvatarRaw || null,
            theme
        });
        if (card) {
            await sock.sendMessage(groupJid, { image: card, caption: text, mentions: [userJid] });
            return true;
        }
    } catch (_) {}
    await sock.sendMessage(groupJid, { text, mentions: [userJid] });
    return true;
}

module.exports = {
    handleGroupParticipantsUpdate: async (sock, anu) => {
        // Invalida cache ANTES de qualquer early-return: mudança de participantes
        // afeta getAdmins/enforcement, não só o dashboard.
        try { clearGroupMetadataCache(anu.id); } catch (_) {}

        // === Analytics !infogrupo: entradas/saídas (últimos 90 dias) ===
        try {
            if (anu.action === 'add' && Array.isArray(anu.participants)) {
                for (const _p of anu.participants) { try { recordModEvent(anu.id, 'join'); } catch (_) {} }
            } else if (anu.action === 'remove' && Array.isArray(anu.participants)) {
                for (const _p of anu.participants) { try { recordModEvent(anu.id, 'leave'); } catch (_) {} }
            }
        } catch (_) {}

        // === Lista negra: auto-ban ao tentar voltar ao grupo ===
        if (anu.action === 'add' && Array.isArray(anu.participants) && anu.participants.length > 0) {
            try {
                const blacklistedToBan = [];
                for (const p of anu.participants) {
                    try { if (isBlacklisted(anu.id, p)) blacklistedToBan.push(p); } catch (_) {}
                }
                if (blacklistedToBan.length > 0) {
                    const isBotAdmin = await botIsAdmin(sock, anu.id);
                    if (!isBotAdmin) {
                        console.log(`🚫 [listanegra] ${blacklistedToBan.length} usuário(s) da lista negra tentaram entrar em ${anu.id}, mas bot não é admin para banir.`);
                    } else {
                        for (const target of blacklistedToBan) {
                            try {
                                await sock.groupParticipantsUpdate(anu.id, [target], 'remove');
                                const phone = target.split('@')[0];
                                console.log(`🚫 [listanegra] auto-ban: ${phone} removido de ${anu.id}`);
                                // Avisa no grupo
                                try {
                                    await sock.sendMessage(anu.id, { text: `🚫 @${phone} está na lista negra e foi removido automaticamente.`, mentions: [target] });
                                } catch (_) {}
                                // Loga no dashboard (se houver metadata para nome)
                                try {
                                    const meta = await groupMetadataCached(sock, anu.id).catch(() => null);
                                    const subject = meta?.subject || 'Grupo';
                                    safeDashboardLog('event', subject, `🚫 Lista negra: @${phone} auto-banido`, null, phone, null, {
                                        toJid: anu.id,
                                        senderJid: target,
                                        fromMe: false
                                    });
                                } catch (_) {}
                            } catch (e) {
                                console.error(`❌ [listanegra] falha ao auto-banir ${target}:`, e.message);
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Erro na verificação de lista negra:', e);
            }
        }

        // === Avisos do grupo com card (foto do grupo no fundo, igual !menu) ===
        // add/remove/promote/demote — cada um com on/off + msg próprios (ver !bemvindo).
        if ((['add', 'remove', 'promote', 'demote'].includes(anu.action)) && Array.isArray(anu.participants) && anu.participants.length > 0) {
            try {
                const gd = getGroupData(anu.id) || {};
                const isJoin = anu.action === 'add';
                const isLeave = anu.action === 'remove';
                const isPromote = anu.action === 'promote';
                const isDemote = anu.action === 'demote';

                // Retrocompat: quem nunca configurou promove/rebaixa começa DESLIGADO.
                // Quem já tinha welcome/goodbye mantém o comportamento antigo.
                const on = isJoin ? !!gd.welcomeOn
                    : isLeave ? !!gd.goodbyeOn
                    : isPromote ? !!gd.promoteOn
                    : !!gd.demoteOn;
                const customMsg = isJoin ? gd.welcomeMsg : isLeave ? gd.goodbyeMsg : isPromote ? gd.promoteMsg : gd.demoteMsg;
                const mode = isJoin ? 'welcome' : isLeave ? 'goodbye' : isPromote ? 'promote' : 'demote';
                const defaultMsg = isJoin ? '👋 Bem-vindo @user ao {grupo}!'
                    : isLeave ? '👋 @user saiu do grupo. Até mais!'
                    : isPromote ? '👑 @user foi promovido a admin do {grupo}! 🎉'
                    : '📉 @user foi rebaixado de admin do {grupo}.';

                if (on) {
                    let subject = 'o grupo';
                    let memberCount = 0;
                    try {
                        const meta = await groupMetadataCached(sock, anu.id).catch(() => null);
                        if (meta?.subject) subject = meta.subject;
                        if (Array.isArray(meta?.participants)) memberCount = meta.participants.length;
                        snapshotGroup(anu.id, meta); // mantém a base do anti-spam atualizada
                    } catch (_) {}
                    const theme = await resolveTheme(anu.id);
                    // Foto do grupo como fundo do card (igual !menu) — busca 1x por evento.
                    let groupAvatarRaw = null;
                    try { groupAvatarRaw = await getGroupAvatarBuffer(sock, anu.id).catch(() => null); } catch (_) {}
                    for (const p of anu.participants) {
                        try {
                            if (isJoin && isBlacklisted(anu.id, p)) continue; // listanegra já tratou
                            await sendEventCard(sock, {
                                groupJid: anu.id, mode, userJid: p,
                                defaultMsg, customMsg, subject, memberCount, theme,
                                groupAvatarRaw,
                                // Na saída o WhatsApp costuma já ter apagado a foto — busca só no resto.
                                fetchUserAvatar: !isLeave
                            });
                        } catch (_) {}
                    }
                }
            } catch (e) {
                console.error('Erro nos avisos de grupo:', e.message);
            }
        }

        if (!isDashboardEnabled(anu.id)) return;
        try {            const metadata = await groupMetadataCached(sock, anu.id).catch(() => null);
            const subject = metadata?.subject || null;
            const memberCount = Array.isArray(metadata?.participants) ? metadata.participants.length : undefined;
            if (subject) {
                safeRemember(anu.id, { subject, memberCount });
            } else if (memberCount !== undefined) {
                safeRemember(anu.id, { memberCount });
            }
            if (!metadata) return;

            for (const num of anu.participants) {
                const phone = num.split('@')[0];
                let text = '';
                if (anu.action === 'add') text = `Entrou no grupo`;
                else if (anu.action === 'remove') text = `Saiu ou foi removido`;
                else if (anu.action === 'promote') text = `Promovido a admin`;
                else if (anu.action === 'demote') text = `Rebaixado de admin`;
                
                if (text) {
                    safeDashboardLog('event', subject || 'Grupo', text, null, phone, null, { 
                        toJid: anu.id, 
                        senderJid: num, 
                        fromMe: false 
                    });
                }
            }
        } catch (e) {
            console.error('Erro no group-participants.update:', e);
        }
    },

    // Mudanças de grupo: avisa SÓ título/descrição que realmente mudaram.
    // O WhatsApp repete subject/desc em quase todo groups.update (ex: ao
    // abrir/fechar o grupo), então compara com o último valor conhecido e
    // fica em silêncio se nada mudou. Abrir/fechar e permissões NÃO avisam.
    handleGroupUpdate: async (sock, updates) => {
        const list = Array.isArray(updates) ? updates : [updates];
        for (const u of list) {
            try {
                if (!u || !u.id || !String(u.id).endsWith('@g.us')) continue;
                try { clearGroupMetadataCache(u.id); } catch (_) {}
                const gd = getGroupData(u.id) || {};
                if (!gd.groupChangeOn) continue;

                // Fonte da verdade: metadados frescos (cache invalidado acima).
                let meta = null;
                try { meta = await groupMetadataCached(sock, u.id).catch(() => null); } catch (_) {}
                const curSubject = (meta && typeof meta.subject === 'string' && meta.subject) || u.subject || null;
                const curDesc = (meta && typeof meta.desc === 'string') ? meta.desc : (typeof u.desc === 'string' ? u.desc : null);

                const prev = _groupSnapshot.get(u.id) || null;
                if (!prev) {
                    // Primeira visão: grava a base sem avisar (evita spam de valores antigos).
                    _groupSnapshot.set(u.id, { subject: curSubject, desc: curDesc });
                    continue;
                }

                // Só entra no aviso o que MUDOU de verdade (texto simples, sem poluir).
                const changes = [];
                if (curSubject && prev.subject && curSubject !== prev.subject) {
                    changes.push(`📝 Título atualizado`);
                }
                if (curSubject && curSubject !== prev.subject) prev.subject = curSubject;
                if (curDesc !== null && prev.desc !== null && curDesc !== prev.desc) {
                    changes.push(`📄 Descrição atualizada`);
                }
                if (curDesc !== null && curDesc !== prev.desc) prev.desc = curDesc;
                if (changes.length === 0) continue; // nada mudou: silêncio, sem poluir

                let subject = curSubject || 'o grupo';
                let memberCount = 0;
                try {
                    if (Array.isArray(meta?.participants)) memberCount = meta.participants.length;
                } catch (_) {}
                const theme = await resolveTheme(u.id);
                const customMsg = (gd.groupChangeMsg || '').toString().trim();
                const detail = changes.join('\n');
                const defaultMsg = detail; // texto simples: só o rótulo do que mudou
                const text = (customMsg || defaultMsg).split('{grupo}').join(subject).split('{mudancas}').join(detail);

                try {
                    let groupAvatarRaw = null;
                    try { groupAvatarRaw = await getGroupAvatarBuffer(sock, u.id).catch(() => null); } catch (_) {}
                    const card = await generateWelcomeImage({
                        mode: 'groupchange',
                        userName: subject.slice(0, 24),
                        groupName: subject,
                        memberCount,
                        message: detail.replace(/\*/g, '').slice(0, 120),
                        avatarRaw: groupAvatarRaw,
                        groupAvatarRaw,
                        theme
                    });
                    if (card) {
                        await sock.sendMessage(u.id, { image: card, caption: text });
                        continue;
                    }
                } catch (_) {}
                await sock.sendMessage(u.id, { text });
            } catch (e) {
                console.error('Erro no group.update:', e.message);
            }
        }
    }
};
