module.exports = {
    name: 'listanegra',
    aliases: ['blacklist', 'bl', 'lista-negra'],
    description: 'Gerencia lista negra do grupo — membros banidos automaticamente ao tentar voltar.',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, args, fullArgsText, config, utils }) {
        if (!isGroup) {
            return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });
        }

        const admins = await utils.getAdmins(sock, from);
        const isSenderAdmin = utils.isUserAdmin(sender, admins);
        if (!isSenderAdmin) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }

        const p = config.prefix || '!';
        const blacklist = utils.getBlacklist(from);

        function formatList() {
            if (!blacklist.length) return '_Lista vazia — nenhum número na lista negra._';
            return blacklist.map((row, i) => {
                const num = row.user_jid.split('@')[0];
                return `${i + 1}. ${num}`;
            }).join('\n');
        }

        function helpText() {
            return `*🚫 Lista Negra — ${blacklist.length} número(s)*\n` +
                `_${formatList()}_\n\n` +
                `╭─── *COMO USAR* ───\n` +
                `│ 📋 *${p}listanegra* — mostra esta lista e instruções\n` +
                `│ ➕ *${p}listanegra @usuario* — marca/menciona para banir e adicionar à lista\n` +
                `│ 💬 *${p}listanegra* (responda msg) — cita mensagem da pessoa\n` +
                `│ 🔢 *${p}listanegra 5511999999999* — digite o número completo com DDD e país\n` +
                `│ ➖ *${p}listanegra remover @usuario* — remove da lista negra\n` +
                `│ ➖ *${p}listanegra remover 5511999999999* — remove número\n` +
                `│ 🧹 *${p}listanegra limpar* — limpa toda a lista negra\n` +
                `╰───────────────\n\n` +
                `*Efeito:* quem está na lista negra é *banido instantaneamente* se tentar voltar ao grupo (mesmo que saia e entre novamente). Válido apenas para este grupo.\n` +
                `*Obs:* O bot precisa ser *admin* para banir automaticamente.`;
        }

        // Sem argumentos -> mostra instruções + lista
        if (!args || args.length === 0) {
            return await sock.sendMessage(from, { text: helpText() }, { quoted: m });
        }

        const lowerArgs = args.map(a => String(a).toLowerCase());
        const isRemoveIntent = lowerArgs.includes('remover') || lowerArgs.includes('remove') || lowerArgs.includes('rem') || lowerArgs.includes('del') || lowerArgs.includes('tirar') || lowerArgs.includes('rm');
        const isClearIntent = lowerArgs.includes('limpar') || lowerArgs.includes('clear') || lowerArgs.includes('clean');

        // Limpar toda a lista
        if (isClearIntent && !isRemoveIntent) {
            if (blacklist.length === 0) {
                return await sock.sendMessage(from, { text: 'ℹ️ A lista negra já está vazia.' }, { quoted: m });
            }
            // Se foi digitado "limpar" sem confirmação, pede confirmação ou limpa direto? Limpa direto com admin já validado.
            // Suporta "limpar" sozinho ou "limpar all"
            const removed = utils.clearBlacklist(from);
            return await sock.sendMessage(from, { text: `🧹 Lista negra limpa! ${removed} número(s) removido(s).` }, { quoted: m });
        }
        if (isClearIntent && isRemoveIntent && (lowerArgs.includes('all') || lowerArgs.includes('todos') || lowerArgs.includes('tudo'))) {
            if (blacklist.length === 0) {
                return await sock.sendMessage(from, { text: 'ℹ️ A lista negra já está vazia.' }, { quoted: m });
            }
            const removed = utils.clearBlacklist(from);
            return await sock.sendMessage(from, { text: `🧹 Lista negra limpa! ${removed} número(s) removido(s).` }, { quoted: m });
        }

        // Extrair alvos: menções, citação e números digitados
        const targets = [];
        const seenUsers = new Set();

        function pushTarget(jid) {
            if (!jid) return;
            const norm = utils.normalizeJid(jid);
            if (!norm) return;
            const user = norm.split('@')[0];
            if (!user || seenUsers.has(user)) return;
            seenUsers.add(user);
            // Ignora tokens que são comandos (remover etc) — já filtrado, mas garante
            targets.push(norm);
        }

        // Menções e citação
        const ctx = m.message?.extendedTextMessage?.contextInfo || utils.getContextInfo(m.message) || {};
        if (Array.isArray(ctx.mentionedJid) && ctx.mentionedJid.length > 0) {
            for (const j of ctx.mentionedJid) pushTarget(j);
        }
        if (ctx.participant) {
            pushTarget(ctx.participant);
        }

        // Números digitados — extrai sequências de 8-15 dígitos do texto completo
        if (fullArgsText) {
            const numberMatches = fullArgsText.match(/\d{8,15}/g);
            if (numberMatches) {
                for (const raw of numberMatches) {
                    const jid = utils.parseNumberToJid(raw);
                    if (jid) pushTarget(jid);
                }
            }
        }
        // Fallback: também verifica args token a token caso número com "+" ou formatado tenha sido quebrado
        for (const a of args) {
            const lower = String(a).toLowerCase();
            if (['remover','remove','rem','del','tirar','rm','limpar','clear','clean','all','todos','tudo'].includes(lower)) continue;
            const digits = String(a).replace(/\D/g, '');
            if (digits.length >= 8 && digits.length <= 15) {
                const jid = utils.parseNumberToJid(digits);
                if (jid) pushTarget(jid);
            }
        }
        // Último fallback: número formatado com espaços/traços/() que foi quebrado (ex: +55 (11) 99999-9999)
        if (targets.length === 0 && fullArgsText) {
            const stripped = fullArgsText.replace(/\D/g, '');
            // evita confundir com keywords: se stripped contém apenas dígitos e tem tamanho válido, trata como um número
            if (stripped.length >= 8 && stripped.length <= 15) {
                const jid = utils.parseNumberToJid(stripped);
                if (jid) pushTarget(jid);
            }
        }

        // Se intenção é remover mas nenhum alvo encontrado
        if (isRemoveIntent) {
            if (targets.length === 0) {
                return await sock.sendMessage(from, { text: `❌ Você precisa marcar, citar ou digitar o número de quem deseja *remover* da lista negra.\n\nEx: *${p}listanegra remover @usuario* ou *${p}listanegra remover 5511999999999*` }, { quoted: m });
            }
            let removedCount = 0;
            let notFoundCount = 0;
            const notFoundNumbers = [];
            for (const t of targets) {
                const ok = utils.removeFromBlacklist(from, t);
                if (ok) removedCount++;
                else { notFoundCount++; notFoundNumbers.push(t.split('@')[0]); }
            }
            let msg = '';
            if (removedCount > 0) msg += `✅ ${removedCount} número(s) removido(s) da lista negra.\n`;
            if (notFoundCount > 0) msg += `ℹ️ ${notFoundCount} não estava(m) na lista: ${notFoundNumbers.join(', ')}\n`;
            msg += `\n*Lista atual:* ${utils.getBlacklist(from).length} número(s)\n${utils.getBlacklist(from).length ? utils.getBlacklist(from).map((r,i)=> `${i+1}. ${r.user_jid.split('@')[0]}`).join('\n') : '_vazia_'}`;
            return await sock.sendMessage(from, { text: msg.trim() }, { quoted: m });
        }

        // Caso contrário: intenção de adicionar à lista negra + banir
        if (targets.length === 0) {
            // Nenhum alvo válido mas tem args — mostra help + lista
            return await sock.sendMessage(from, { text: `❌ Você precisa *marcar*, *citar* (responder mensagem) ou *digitar o número* para adicionar à lista negra.\n\n` + helpText() }, { quoted: m });
        }

        const isBotAdmin = await utils.botIsAdmin(sock, from);
        let metadata = null;
        try { metadata = await utils.groupMetadataCached(sock, from); } catch (_) {}

        const participantsSet = new Set();
        if (metadata && Array.isArray(metadata.participants)) {
            for (const pinfo of metadata.participants) {
                const pid = pinfo.id || pinfo.jid || '';
                if (pid) participantsSet.add(utils.normalizeJid(pid).split('@')[0]);
            }
        }

        let added = 0;
        let already = 0;
        let adminSkipped = 0;
        let kicked = 0;
        const addedNumbers = [];
        const alreadyNumbers = [];
        const adminNumbers = [];

        for (const t of targets) {
            // Não permite adicionar admin
            if (utils.isUserAdmin(t, admins)) {
                adminSkipped++;
                adminNumbers.push(t.split('@')[0]);
                continue;
            }
            if (utils.isBlacklisted(from, t)) {
                already++;
                alreadyNumbers.push(t.split('@')[0]);
                // Mesmo já estando na lista, tenta banir se ainda estiver no grupo
                if (isBotAdmin && participantsSet.has(t.split('@')[0])) {
                    try {
                        await sock.groupParticipantsUpdate(from, [t], 'remove');
                        kicked++;
                    } catch (_) {}
                }
                continue;
            }
            const ok = utils.addToBlacklist(from, t, sender);
            if (ok) {
                added++;
                addedNumbers.push(t.split('@')[0]);
                // Tenta banir instantaneamente se estiver no grupo
                if (isBotAdmin && participantsSet.has(t.split('@')[0])) {
                    try {
                        await sock.groupParticipantsUpdate(from, [t], 'remove');
                        kicked++;
                    } catch (e) {
                        console.error('[listanegra] falha ao banir:', e.message);
                    }
                }
            }
        }

        let response = '';
        if (added > 0) response += `🚫 *${added} número(s) adicionado(s) à lista negra:* ${addedNumbers.join(', ')}\n`;
        if (already > 0) response += `ℹ️ ${already} já estava(m) na lista: ${alreadyNumbers.join(', ')}\n`;
        if (adminSkipped > 0) response += `⚠️ ${adminSkipped} é/são admin e não pode(m) ser adicionado(s): ${adminNumbers.join(', ')}\n`;
        if (kicked > 0) response += `✅ ${kicked} usuário(s) banido(s) instantaneamente.\n`;
        if (added > 0 && !isBotAdmin) response += `⚠️ Bot não é admin — não foi possível banir agora, mas o auto-ban funcionará quando o bot for promovido e o usuário tentar voltar.\n`;
        if (added > 0 || already > 0) {
            const curList = utils.getBlacklist(from);
            response += `\n*Lista negra atual (${curList.length}):*\n${curList.map((r,i)=> `${i+1}. ${r.user_jid.split('@')[0]}`).join('\n')}`;
        }

        if (!response) response = '❌ Nenhum número válido processado.';

        return await sock.sendMessage(from, { text: response.trim() }, { quoted: m });
    }
};
