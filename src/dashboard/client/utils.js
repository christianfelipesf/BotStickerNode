/* utils.js — helpers compartilhados (esc, cores, toast, sons, ALL, refs) */
(function (D) {
    'use strict';

    D.refs = {};
    D.ALL = '__all__';

    function $(id) { return document.getElementById(id); }

    D.utils = {
        $: $,

        // Escapa HTML para uso seguro em template strings
        esc: function (s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },

        // Iniciais para avatar fallback (ex.: "Ana Silva" -> "AS")
        initials: function (n) {
            const p = String(n || '?').trim().split(/\s+/);
            if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
            return (p[0][0] || '') + (p[1][0] || '');
        },

        // Cor consistente por hash do telefone/jid
        userColor: function (ph) {
            if (!ph) return 'var(--g)';
            const c = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6',
                       '#e67e22', '#1abc9c', '#d35400', '#c0392b', '#27ae60',
                       '#2980b9', '#8e44ad', '#f39c12', '#16a085'];
            let h = 0;
            for (let i = 0; i < ph.length; i++) {
                h = ph.charCodeAt(i) + ((h << 5) - h);
            }
            return c[Math.abs(h) % c.length];
        },

        toast: function (m, ms) {
            const el = D.refs.toast;
            if (!el) return;
            el.textContent = m;
            el.classList.add('show');
            clearTimeout(el._t);
            el._t = setTimeout(() => el.classList.remove('show'), ms || 2200);
        },

        play: function (audio) {
            if (!D.state.soundEnabled || !audio) return;
            try {
                audio.volume = 0.6;
                audio.currentTime = 0;
                audio.play().catch(() => {});
            } catch (_) {}
        },

        // Captura todos os refs DOM necessários (chamado uma vez no bootstrap)
        cacheRefs: function () {
            D.refs = {
                chat: $('chat'),
                groupList: $('groupList'),
                groupSearch: $('groupSearch'),
                chatName: $('chatName'),
                chatSub: $('chatSub'),
                chatAvatar: $('chatAvatar'),
                status: $('status'),
                soundChat: $('sound-chat'),
                soundAction: $('sound-action'),
                soundError: $('sound-error'),
                notifBtn: $('notif-btn'),
                pushBtn: $('push-btn'),
                replyBar: $('replyBar'),
                replyName: $('replyName'),
                replyText: $('replyText'),
                attachments: $('attachments'),
                messageInput: $('messageInput'),
                sendBtn: $('sendBtn'),
                fileInput: $('fileInput'),
                composer: $('composer'),
                toast: $('toast'),
                backBtn: $('backBtn'),
                mobileBackFromStats: null,
                openStatsMobile: $('openStatsMobile'),
                colStats: $('colStats'),
                mobileTabbar: $('mobileTabbar'),
                sysBotState: $('sysBotState'),
                sysPid: $('sysPid'),
                sysRestarts: $('sysRestarts'),
                sysCommands: $('sysCommands'),
                cpuBar: $('cpuBar'),
                cpuLabel: $('cpuLabel'),
                cpuMeta: $('cpuMeta'),
                ramBar: $('ramBar'),
                ramLabel: $('ramLabel'),
                ramMeta: $('ramMeta'),
                procRss: $('procRss'),
                procHeap: $('procHeap'),
                sysNode: $('sysNode'),
                sysPlatform: $('sysPlatform'),
                sysUptime: $('sysUptime'),
                sysGroupsTotal: $('sysGroupsTotal'),
                sysGroupsActive: $('sysGroupsActive'),
                sysGroupsPartial: $('sysGroupsPartial'),
                sysLogs: $('sysLogs'),
                sysFiles: $('sysFiles')
            };
        }
    };
})(window.Dashboard = window.Dashboard || {});
