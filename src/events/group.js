const { isDashboardEnabled, getDashboardGroupInfo, upsertDashboardGroupInfo } = require('../database/utils');
const dashboard = require('../dashboard/dashboard');

const safeDashboardLog = (...args) => { try { dashboard.log(...args); } catch (_) {} };
const safeRemember = (...args) => { try { dashboard.rememberGroupInfo(...args); } catch (_) {} };

module.exports = {
    handleGroupParticipantsUpdate: async (sock, anu) => {
        if (!isDashboardEnabled(anu.id)) return;
        try {
            const metadata = await sock.groupMetadata(anu.id).catch(() => null);
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
