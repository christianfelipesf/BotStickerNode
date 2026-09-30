// aiContext.js — bloco de contexto de fundo para o !ai.
// A IA recebe esses dados como REFERÊNCIA (sabe a situação da conversa),
// não como assunto para responder — o cabeçalho deixa isso explícito.
// Tudo com try/catch por campo: se algo falhar, o campo é omitido e o
// comando segue normalmente. Bloco total mira < 800 caracteres.

function clean(s, n) {
    return String(s == null ? '' : s)
        .replace(/[\x00-\x1F\x7F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, n);
}

function fmtTime(ts) {
    try {
        return new Date(Number(ts)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
}

async function buildAIContextBlock(sock, { from, isGroup, sender, senderName, commandName, m, config, utils } = {}) {
    const lines = [];
    try {
        // 1. Comando executado + total geral (leitura SQLite síncrona, ~0ms).
        try {
            const stats = utils?.readStats?.();
            const total = stats ? Number(stats.totalCommands) : NaN;
            lines.push(`• Comando executado: !${clean(commandName || 'ai', 30)}`
                + (Number.isFinite(total) ? ` (total geral: ${total} comandos)` : ''));
        } catch (_) {}

        // 2. Identidade do bot + versão (getVersion tem cache interno).
        try {
            const botName = clean(utils?.getBotName?.(from, config) || config?.botName || 'Bot', 30) || 'Bot';
            const ver = clean(utils?.getVersion?.() || '', 30);
            lines.push(`• Bot: ${botName}` + (ver ? ` (${ver})` : ''));
        } catch (_) {}

        // 3. Uptime + data/hora atual (BRT).
        try {
            const parts = [];
            try {
                const up = utils?.formatUptime?.(process.uptime());
                if (up) parts.push(`Online há: ${up}`);
            } catch (_) {}
            try {
                const now = new Date().toLocaleString('pt-BR', {
                    timeZone: 'America/Sao_Paulo',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
                if (now) parts.push(`Agora: ${now} (BRT)`);
            } catch (_) {}
            if (parts.length > 0) lines.push(`• ${parts.join(' • ')}`);
        } catch (_) {}

        // 2. Quantidade de grupos com bot ativo (banco local, sem rede).
        try {
            const list = utils?.listActiveGroups?.();
            if (Array.isArray(list)) lines.push(`• Grupos com bot ativo: ${list.length}`);
        } catch (_) {}

        // 3. Grupo atual + 4. se o solicitante é admin.
        if (isGroup) {
            try {
                const gm = await utils?.groupMetadataCached?.(sock, from);
                const subject = clean(gm?.subject || 'Grupo', 60) || 'Grupo';
                const members = Array.isArray(gm?.participants) ? gm.participants.length : null;
                lines.push(`• Grupo atual: ${subject}` + (members != null ? ` (${members} membros)` : ''));
            } catch (_) { lines.push('• Grupo atual: (não identificado)'); }

            try {
                const name = clean(senderName || m?.pushName || 'Usuário', 30) || 'Usuário';
                if (m?.key?.fromMe) {
                    lines.push(`• Solicitante: ${name} (é o próprio bot)`);
                } else {
                    const admins = await utils?.getAdmins?.(sock, from);
                    const isAdmin = utils?.isUserAdmin?.(sender, admins);
                    lines.push(`• Solicitante: ${name} (admin: ${isAdmin ? 'sim' : 'não'})`);
                }
            } catch (_) {
                const name = clean(senderName || 'Usuário', 30) || 'Usuário';
                lines.push(`• Solicitante: ${name}`);
            }
        } else {
            const name = clean(senderName || m?.pushName || 'Usuário', 30) || 'Usuário';
            lines.push('• Conversa: privada (não é grupo)');
            lines.push(`• Solicitante: ${name}`);
        }

        // 5. Últimas 3 mensagens (o histórico já exclui comandos — message.js
        // só salva texto sem prefixo — então são as 3 anteriores de verdade).
        try {
            const hist = utils?.getChatHistory?.(from, 3) || [];
            if (Array.isArray(hist) && hist.length > 0) {
                lines.push('• Últimas mensagens:');
                for (const h of hist.slice(-3)) {
                    const t = fmtTime(h?.time);
                    const who = clean(h?.pushName || 'Usuário', 25) || 'Usuário';
                    const txt = clean(h?.text || '', 150);
                    if (txt) lines.push(`  [${t}] ${who}: ${txt}`);
                }
            }
        } catch (_) {}

        if (lines.length === 0) return '';
        return '[Contexto da conversa — apenas referência, não responda sobre isso salvo se perguntado]\n'
            + lines.join('\n');
    } catch (_) { return ''; }
}

module.exports = { buildAIContextBlock };
