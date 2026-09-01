const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'feedbacklog',
    aliases: [],
    category: 'admin',
    description: 'Envia TXT com últimos bugs e sugestões (marca tipo) — só admin',
    async execute(sock, m, { from, isGroup, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, normalizeJid, getAdmins, isUserAdmin, listFeedback, getBotName } = utils;

        // Permissão: grupo -> só admin/dono ; PV -> só dono
        const meId = normalizeJid(sock.user?.id || '');
        const senderNorm = normalizeJid(sender);
        const isOwner = m.key.fromMe || sender === meId || senderNorm === meId;

        let allowed = isOwner;
        if (!allowed && isGroup) {
            try {
                const admins = await getAdmins(sock, from);
                allowed = isUserAdmin(sender, admins);
            } catch (_) { allowed = false; }
        }

        if (!allowed) {
            const msg = isGroup
                ? '❌ Apenas *admins* do grupo podem ver os logs de feedback.'
                : '❌ Apenas o dono do bot pode usar este comando.';
            await sock.sendMessage(from, { text: msg }, { quoted: m });
            return lastBotResponse;
        }

        let current = await react(sock, m, '📋', lastBotResponse, GLOBAL_COOLDOWN);

        const bugs = listFeedback('bug', 10) || [];
        const sugs = listFeedback('sugestao', 10) || [];

        // mescla ambos e ordena por created_at crescente (antigo -> novo) para TXT legível
        const all = [
            ...bugs.map(r => ({ ...r, tipo: 'BUG' })),
            ...sugs.map(r => ({ ...r, tipo: 'SUGESTÃO' }))
        ].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const stamp = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fileName = `feedbacks_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}.txt`;
        const filePath = path.join(tempDir, fileName);

        const botName = getBotName(from, config);

        const headerLines = [
            `# ${botName} — Feedbacks (BUG + SUGESTÃO)`,
            `# Gerado em: ${stamp.toLocaleString('pt-BR')}`,
            `# Total: ${bugs.length} bug(s) + ${sugs.length} sugestão(ões) = ${all.length} registro(s) (máx 10 cada)`,
            `# Arquivo único — coluna TIPO marca se é BUG ou SUGESTÃO`,
            `# ─────────────────────────────────────────────`,
            ''
        ];

        let body = '';
        if (all.length === 0) {
            body = '(nenhum feedback registrado ainda — use !bug <msg> ou !sugestao <msg>)';
        } else {
            const blocks = all.map((r, idx) => {
                const d = new Date(r.created_at || Date.now());
                const data = d.toLocaleString('pt-BR');
                const tipo = r.tipo === 'BUG' ? '🐛 BUG' : '💡 SUGESTÃO';
                const nome = r.sender_name || 'Anônimo';
                const phone = r.sender_jid ? r.sender_jid.split('@')[0] : '—';
                const grupo = r.group_jid || '(PV)';
                // escapa quebras excessivas
                const texto = String(r.text || '').replace(/\r/g, '').trim();
                return [
                    `— ${idx + 1}. [${tipo}] em ${data}`,
                    `   De: ${nome} (${phone}) | Grupo: ${grupo}`,
                    `   ${texto.split('\n').join('\n   ')}`,
                    ''
                ].join('\n');
            });
            body = blocks.join('\n');
        }

        fs.writeFileSync(filePath, headerLines.join('\n') + body + '\n', 'utf8');
        const sizeKb = Math.max(1, Math.round(fs.statSync(filePath).size / 1024));

        const caption = all.length
            ? `📋 *Feedbacks — BUG + SUGESTÃO*\n` +
              `🐛 *Bugs:* ${bugs.length} | 💡 *Sugestões:* ${sugs.length} | 📄 *Total:* ${all.length}\n` +
              `💾 *Tamanho:* ${sizeKb} KB\n` +
              `_Arquivo único — coluna [BUG]/[SUGESTÃO] indica o tipo._`
            : `📋 *Feedbacks*\n⚠️ Nenhum registro ainda.`;

        try {
            await sock.sendMessage(from, {
                document: fs.readFileSync(filePath),
                fileName,
                mimetype: 'text/plain',
                caption
            }, { quoted: m });
            current = await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
        } catch (err) {
            await sock.sendMessage(from, { text: `❌ Falha ao enviar TXT: ${err.message || err}` }, { quoted: m });
            current = await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        } finally {
            try { fs.unlinkSync(filePath); } catch (_) {}
        }

        return current;
    }
};
