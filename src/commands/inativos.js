module.exports = {
    name: 'inativos',
    aliases: ['fantasmas', 'inativoslist', 'verinativos', 'fantasma'],
    description: 'Lista membros sem mensagem no mês (fantasmas). Ex: !inativos [10]',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, args, utils }) {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        const admins = await utils.getAdmins(sock, from);
        if (!utils.isUserAdmin(sender, admins)) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }

        const limit = Math.max(1, Math.min(50, Number(args?.[0]) || 20));

        let participants = [];
        try {
            const meta = await utils.groupMetadataCached(sock, from);
            participants = Array.isArray(meta?.participants) ? meta.participants : [];
        } catch (_) { participants = []; }
        if (participants.length === 0) {
            return await sock.sendMessage(from, { text: '❌ Não consegui ler os membros do grupo.' }, { quoted: m });
        }

        let rank = [];
        try { rank = utils.getMonthlyRank(from, 50) || []; } catch (_) { rank = []; }
        const activeDigits = new Set();
        for (const r of rank) {
            const d = String(r.jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
            if (d.length >= 8) activeDigits.add(d.slice(-11));
        }

        const ghosts = [];
        for (const p of participants) {
            const jid = p.id || p.jid;
            if (!jid || jid.endsWith('@lid')) continue;
            if (utils.isUserAdmin(jid, admins)) continue;
            const digits = String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
            if (digits.length < 8) continue;
            if (!activeDigits.has(digits.slice(-11))) ghosts.push(jid);
        }

        if (ghosts.length === 0) {
            return await sock.sendMessage(from, { text: '🎉 Ninguém inativo! Todo mundo mandou ao menos 1 mensagem no mês.' }, { quoted: m });
        }

        const shown = ghosts.slice(0, limit);
        const lines = shown.map((j, i) => `${i + 1}. @${String(j).split('@')[0]}`);
        const extra = ghosts.length > shown.length ? `\n\n…e mais ${ghosts.length - shown.length} (use !inativos ${Math.min(50, ghosts.length)})` : '';
        return await sock.sendMessage(from, { text: `👻 *Inativos no mês (${ghosts.length})*\nSem nenhuma mensagem registrada:\n${lines.join('\n')}${extra}`, mentions: shown }, { quoted: m });
    }
};
