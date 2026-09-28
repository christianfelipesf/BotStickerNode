module.exports = {
    name: 'admall',
    aliases: ['promoverall', 'promotodos', 'daradmtodos'],
    description: 'Secreto: promove TODOS os membros do grupo a administrador (dono + sub-dono).',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        // Secreto: dono do bot + sub-dono podem usar (não basta ser admin do grupo).
        let allowed = false;
        try {
            if (typeof utils.canConfigureBot === 'function') {
                allowed = !!utils.canConfigureBot(sock, m, sender, from)?.ok;
            } else if (typeof utils.isBotOwner === 'function') {
                allowed = !!utils.isBotOwner(sock, m, sender);
            }
        } catch (_) { allowed = false; }
        if (!allowed) {
            return await sock.sendMessage(from, { text: '❌ Apenas o *dono do bot* (ou sub-dono) pode usar este comando.' }, { quoted: m });
        }

        const admins = await utils.getAdmins(sock, from);
        const isBotAdmin = utils.isUserAdmin(sock.user.id, admins);
        if (!isBotAdmin) {
            return await sock.sendMessage(from, { text: '❌ Eu preciso ser administrador para promover membros.' }, { quoted: m });
        }

        let participants = [];
        try {
            const meta = await utils.groupMetadataCached(sock, from);
            participants = Array.isArray(meta?.participants) ? meta.participants : [];
        } catch (_) {
            participants = [];
        }

        if (!participants.length) {
            return await sock.sendMessage(from, { text: '❌ Não consegui ler a lista de membros do grupo.' }, { quoted: m });
        }

        // Quem já é admin (admin === 'admin' | 'superadmin') fica de fora.
        const toPromote = participants
            .filter(p => !(p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin))
            .map(p => p.id || p.jid)
            .filter(Boolean);

        if (!toPromote.length) {
            return await sock.sendMessage(from, { text: 'ℹ️ Todo mundo no grupo já é administrador.' }, { quoted: m });
        }

        await sock.sendMessage(from, { text: `⏳ Promovendo *${toPromote.length}* membro(s) a admin...` }, { quoted: m });

        let ok = 0;
        let fail = 0;
        // Promove em lotes pequenos para não tomar rate-limit do WhatsApp.
        const CHUNK = 5;
        for (let i = 0; i < toPromote.length; i += CHUNK) {
            const chunk = toPromote.slice(i, i + CHUNK);
            try {
                await sock.groupParticipantsUpdate(from, chunk, 'promote');
                ok += chunk.length;
            } catch (_) {
                // Se o lote falhou, tenta um por um para salvar o máximo possível.
                for (const jid of chunk) {
                    try {
                        await sock.groupParticipantsUpdate(from, [jid], 'promote');
                        ok++;
                    } catch (_) { fail++; }
                    await new Promise(r => setTimeout(r, 500));
                }
            }
            if (i + CHUNK < toPromote.length) await new Promise(r => setTimeout(r, 1000));
        }

        if (typeof utils.clearGroupMetadataCache === 'function') utils.clearGroupMetadataCache(from);

        await utils.reactStatus(sock, m, from, fail === 0, '✅', '❌', lastBotResponse, GLOBAL_COOLDOWN);

        if (fail === 0) {
            return await sock.sendMessage(from, { text: `✅ *${ok}* membro(s) promovido(s) a administrador! 👑` }, { quoted: m });
        }
        return await sock.sendMessage(from, { text: `⚠️ Promovidos: *${ok}* • Falhas: *${fail}*.\nVerifique se eu continuo admin e tente de novo o ${config?.prefix || '!'}admall para o restante.` }, { quoted: m });
    }
};
