/* state.js — estado reativo (msgsByJid, groups, activeJid, attachments, settings) */
(function (D) {
    'use strict';

    D.state = {
        // Mensagens indexadas por JID do grupo
        msgsByJid: {},

        // Última data renderizada (controla day separators no chat)
        lastDate: '',

        // Lista de grupos retornada pelo socket
        groups: [],

        // JID ativo ou D.ALL para "Todos os grupos"
        activeJid: null,

        // Reply pendente (mensagem sendo respondida)
        currentReply: null,

        // Anexos pendentes no composer
        pendingAttachments: [],

        // Preferências do usuário (persistidas em localStorage)
        soundEnabled: localStorage.getItem('wa_sound') === '1',
        pushEnabled: localStorage.getItem('wa_push') === '1',

        // Lista achatada de todas as mensagens (calculada)
        allMsgs: function () {
            return Object.values(this.msgsByJid)
                .flat()
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        },

        // Reset total (chamado por !dashreset)
        reset: function () {
            this.msgsByJid = {};
            this.lastDate = '';
        }
    };
})(window.Dashboard = window.Dashboard || {});
