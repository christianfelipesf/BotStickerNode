const { isDashboardEnabled } = require('../database/utils');
const dashboard = require('../dashboard/dashboard');

const safeDashboardLog = (...args) => { try { dashboard.log(...args); } catch (_) {} };

module.exports = {
    handleGroupParticipantsUpdate: async (sock, anu) => {
        if (!isDashboardEnabled(anu.id)) return;
        try {
            const metadata = await sock.groupMetadata(anu.id);
            for (const num of anu.participants) {
                const phone = num.split('@')[0];
                let text = '';
                if (anu.action === 'add') text = `Entrou no grupo`;
                else if (anu.action === 'remove') text = `Saiu ou foi removido`;
                else if (anu.action === 'promote') text = `Promovido a admin`;
                else if (anu.action === 'demote') text = `Rebaixado de admin`;
                
                if (text) {
                    safeDashboardLog('event', metadata.subject, text, null, phone, null, { 
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
