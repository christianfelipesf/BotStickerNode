/* index.js — bootstrap: captura refs, expõe window.*, inicializa módulos */
(function (D) {
    'use strict';

    function init() {
        D.utils.cacheRefs();
        D.ui.applyTheme();

        // Bind UI handlers
        D.ui.bind();
        D.upload.bind();
        D.reply.bind();
        D.socket.bind();

        // Expõe handlers usados via inline onclick no HTML
        window.toggleSound = D.ui.toggleSound;
        window.togglePush = D.ui.togglePush;
        window.selAll = D.ui.selAll;
        window.selG = D.ui.selG;
        window.clearReply = D.reply.clearReply;
        window.openReply = D.reply.openReply;
        window.sendCurrent = D.reply.sendCurrent;

        // Estado inicial
        D.ui.setScreen('chats');
        D.ui.renderGroups();
        D.stats.start();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window.Dashboard = window.Dashboard || {});
