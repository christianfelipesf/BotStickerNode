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

        // Context info toggles para envio de mensagens
        contextInfo: {
            forwarded: localStorage.getItem('wa_ctx_fwd') === '1',
            mentionAll: localStorage.getItem('wa_ctx_men') === '1'
        },

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
        },

        // Alterna uma opção de context info e persiste
        toggleContextInfo: function (key) {
            const val = !this.contextInfo[key];
            this.contextInfo[key] = val;
            const lsKey = 'wa_ctx_' + key.substring(0, 3);
            localStorage.setItem(lsKey, val ? '1' : '0');
        },

        // Reseta todas as opções de context info
        resetContextInfo: function () {
            for (const k in this.contextInfo) {
                this.contextInfo[k] = false;
                const lsKey = 'wa_ctx_' + k.substring(0, 3);
                localStorage.removeItem(lsKey);
            }
        }
    };
})(window.Dashboard = window.Dashboard || {});
