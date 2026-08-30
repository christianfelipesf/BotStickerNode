const { isDashboardEnabled, getDashboardGroupInfo, upsertDashboardGroupInfo, groupMetadataCached, clearGroupMetadataCache, isBlacklisted, botIsAdmin } = require('../database/utils');
const dashboard = require('../dashboard/dashboard');

const safeDashboardLog = (...args) => { try { dashboard.log(...args); } catch (_) {} };
const safeRemember = (...args) => { try { dashboard.rememberGroupInfo(...args); } catch (_) {} };

module.exports = {
    handleGroupParticipantsUpdate: async (sock, anu) => {
        // Invalida cache ANTES de qualquer early-return: mudança de participantes
        // afeta getAdmins/enforcement, não só o dashboard.
        try { clearGroupMetadataCache(anu.id); } catch (_) {}

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

        if (!isDashboardEnabled(anu.id)) return;
        try {
            const metadata = await groupMetadataCached(sock, anu.id).catch(() => null);
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
    }
};
