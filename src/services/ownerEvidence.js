// ownerEvidence.js — evidências para o !aidono (somente leitura).
// Resolve alvos (menções múltiplas, citado, número, nome de grupo) e monta
// um pacote compacto de evidências (advs + mensagens recentes + atividade).
// Tudo local (SQLite). matchFactual responde perguntas factuais sem IA (R$0).

function clean(s, n) {
    return String(s == null ? '' : s)
        .replace(/[\x00-\x1F\x7F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, n);
}

function digitsOf(jid) {
    const m = String(jid || '').split('@')[0].split(':')[0];
    return /^\d{8,15}$/.test(m) ? m : null;
}

// 14+ dígitos = LID do WhatsApp (ex.: 73680331751662@lid), NÃO telefone.
// Telefones com DDI têm no máx. 13 dígitos. Errar o domínio zera a busca.
function jidFromDigits(digits) {
    const d = String(digits || '').replace(/\D/g, '');
    if (!/^\d{8,}$/.test(d)) return null;
    return d.length >= 14 ? `${d}@lid` : `${d}@s.whatsapp.net`;
}

function displayName(row, fallback) {
    const n = clean(row?.name || '', 30);
    if (n && !['usuário', 'usuario'].includes(n.toLowerCase())) return n;
    const d = digitsOf(row?.phone ? `${row.phone}@s.whatsapp.net` : row?.senderJid) || digitsOf(fallback);
    return d ? `@${d}` : (fallback ? clean(fallback, 20) : 'Usuário');
}

// Rótulo seguro para o prompt: jid/LID e sequências só-numéricas longas
// (ex.: 86522200076318@lid) são identificadores internos — a IA nunca deve
// vê-los nem repeti-los. Telefones reais curtos (8-13 dígitos) o dono
// reconhece, então podem aparecer. Todo o resto vira tag ("pessoa A"...).
function safePersonLabel(name, tag) {
    const n = clean(name || '', 30);
    if (n && !/@/.test(n) && !/^\d+$/.test(n)) return n; // nome humano
    if (n && /^@?\d{8,13}$/.test(n)) return n.startsWith('@') ? n : `@${n}`; // telefone real
    return tag || 'pessoa mencionada';
}

function personTag(index, total) {
    if (total > 1 && Number.isInteger(index)) return `pessoa ${String.fromCharCode(65 + (index % 26))}`;
    return 'pessoa mencionada';
}

// Dígitos de LID nunca são exibidos (parecem telefone mas não são).
function isLidJid(jid) {
    return typeof jid === 'string' && jid.toLowerCase().endsWith('@lid');
}

// Tenta achar o "outro jid" da mesma pessoa (LID <-> número real) para a
// busca cobrir as mensagens salvas sob qualquer das identidades.
async function resolveAlias(sock, jid, groupJid, utils) {
    if (!jid) return null;
    try {
        if (String(jid).endsWith('@lid') && groupJid && groupJid.endsWith('@g.us')) {
            const other = await utils?.resolveLidPhoneInGroup?.(sock, String(jid).split('@')[0], groupJid);
            if (other && typeof other === 'string' && other.includes('@')) return other;
            if (other && (other.pn || other.phone)) {
                const p = String(other.pn || other.phone).replace(/\D/g, '');
                if (/^\d{8,15}$/.test(p)) return `${p}@s.whatsapp.net`;
            }
        }
    } catch (_) {}
    return null;
}

// Extrai candidatos a grupo pelo nome: "grupo X", "do grupo X", "no X".
function extractGroupNameMention(text, groupSubjects) {
    const t = String(text || '');
    const m = t.match(/(?:grupo|gp)\s+([^?,!.]{2,60})/i);
    const candidates = [];
    if (m) candidates.push(m[1].trim());
    // tenta também o texto todo como nome (ex.: "!aidono Amigos o que acha?")
    candidates.push(t.slice(0, 60).trim());
    const lower = (s) => String(s || '').toLowerCase();
    for (const cand of candidates) {
        if (!cand) continue;
        const hit = (groupSubjects || []).find((g) => lower(g.subject).includes(lower(cand)) || lower(cand).includes(lower(g.subject)));
        if (hit) return hit;
    }
    return null;
}

async function resolveTargets(sock, m, questionText, utils, from) {
    const people = [];
    const groups = [];
    const seenP = new Set();
    const seenG = new Set();
    const ctx = m.message?.extendedTextMessage?.contextInfo || {};

    const pushPerson = (jid, nameHint) => {
        const norm = utils?.normalizeJid ? utils.normalizeJid(jid) : String(jid);
        if (!norm || seenP.has(norm)) return;
        seenP.add(norm);
        people.push({ jid: norm, nameHint: nameHint || null });
    };

    // 1. Menções (várias!) — @a @b @c.
    const mentioned = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid : [];
    for (const j of mentioned) if (j) pushPerson(j);

    // 2. Mensagem citada (respondeu alguém).
    if (ctx.participant) pushPerson(ctx.participant, ctx.pushName || null);

    // 3. Números digitados no texto (8+ dígitos; 14+ = LID).
    const phones = String(questionText || '').match(/\d{8,}/g) || [];
    for (const p of phones) {
        const jid = jidFromDigits(p);
        if (jid) pushPerson(jid);
    }

    // 4. Grupo pelo nome (via infos do dashboard).
    try {
        const infos = utils?.listDashboardGroupInfos?.() || [];
        const hit = extractGroupNameMention(questionText, infos);
        if (hit && hit.jid && !seenG.has(hit.jid)) {
            seenG.add(hit.jid);
            groups.push({ jid: hit.jid, subject: hit.subject || 'Grupo' });
        }
    } catch (_) {}

    // Aliases LID<->número para cada pessoa.
    const groupCtx = from && String(from).endsWith('@g.us') ? from : (groups[0]?.jid || null);
    for (const p of people) {
        p.alias = await resolveAlias(sock, p.jid, groupCtx, utils);
    }
    return { people, groups };
}

function fmtWhen(ts) {
    try {
        return new Date(Number(ts)).toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    } catch (_) { return ''; }
}

function warningsOf(utils, groupJid, personJid) {
    try {
        const gd = utils?.getGroupData?.(groupJid) || {};
        const w = (gd.warnings && typeof gd.warnings === 'object') ? gd.warnings : {};
        // chave pode estar em LID ou número — compara pelo usuário.
        const userOf = (j) => String(j || '').split('@')[0].split(':')[0];
        const target = userOf(personJid);
        let total = Number(w[personJid]) || 0;
        if (!total) {
            for (const [k, v] of Object.entries(w)) {
                if (userOf(k) === target) { total = Number(v) || 0; break; }
            }
        }
        return total;
    } catch (_) { return 0; }
}

function wantsLogs(question) {
    return /log|erro|falha|bug|travou|parou|quebrou|comando\s+(rodou|execut|usou|foi)|quais comandos|últimos? erros?|erros? recentes?/i.test(String(question || ''));
}

async function buildEvidence(sock, { people, groups }, { from, isGroup, utils, msgLimit = 15, msgChars = 150, groupMsgChars = 130, question = '' }) {
    const lines = [];
    const stats = { people: [], groups: [], logs: null };

    // Nome de grupo com proveniência: metadados ao vivo > nome nos logs > infos > jid curto.
    // Nomes genéricos ('Grupo', 'PV' etc.) contam como MISS e caem para a próxima fonte.
    const GENERIC_NAMES = new Set(['grupo', 'pv', 'privado', 'chat', 'desconhecido', 'sem nome', 'grupo atual']);
    const isGenericName = (n) => !n || GENERIC_NAMES.has(String(n).trim().toLowerCase());
    const groupNames = new Map();
    async function groupName(jid) {
        if (!jid) return 'PV';
        if (groupNames.has(jid)) return groupNames.get(jid);
        let name = null;
        try {
            const gm = await utils?.groupMetadataCached?.(sock, jid).catch(() => null);
            if (gm?.subject && !isGenericName(gm.subject)) name = gm.subject;
        } catch (_) {}
        if (!name) {
            try {
                const g = utils?.getGroupSubject?.(jid);
                if (g && !isGenericName(g)) name = g;
            } catch (_) {}
        }
        if (!name) {
            try {
                const gi = utils?.getDashboardGroupInfo?.(jid);
                if (gi?.subject && !isGenericName(gi.subject)) name = gi.subject;
            } catch (_) {}
        }
        if (!name) {
            try {
                for (const g of (utils?.listDashboardGroupInfos?.() || [])) {
                    if (g.jid === jid && g.subject && !isGenericName(g.subject)) { name = g.subject; break; }
                }
            } catch (_) {}
        }
        if (!name) name = String(jid).split('@')[0].slice(-6);
        groupNames.set(jid, name);
        return name;
    }

    // Grupo atual entra como contexto quando o comando roda em grupo.
    const groupJids = [...groups.map((g) => g.jid)];
    if (isGroup && from && !groupJids.includes(from)) groupJids.push(from);

    // Linha de resolução: diz à IA QUEM é cada alvo (o bot resolveu o
    // número/menção -> pessoa de forma determinística). Sem ela, a IA vê
    // dígitos na pergunta e nome na evidência e se recusa a ligar os dois.
    const resoParts = [];
    const isTagLabel = (l) => /^(pessoa mencionada|pessoa [A-Z])$/.test(String(l || ''));

    // Autores desconhecidos ganham tags estáveis (pessoa A/B...) em vez do jid.
    // Dígitos de LID nunca aparecem (parecem telefone, mas não são).
    const authorTags = new Map();
    let authorSeq = 0;
    const authorLabel = (ml) => {
        const raw = displayName(ml);
        if (ml?.senderJid && isLidJid(ml.senderJid) && /^@?\d+$/.test(String(raw || ''))) {
            const key = ml.senderJid;
            if (!authorTags.has(key)) authorTags.set(key, `pessoa ${String.fromCharCode(65 + (authorSeq++ % 26))}`);
            return authorTags.get(key);
        }
        const n = clean(raw || '', 30);
        if (n && !/@/.test(n) && !/^\d+$/.test(n)) return n;
        if (n && /^@?\d{8,13}$/.test(n)) return n.startsWith('@') ? n : `@${n}`;
        const key = ml?.senderJid || raw;
        if (!authorTags.has(key)) authorTags.set(key, `pessoa ${String.fromCharCode(65 + (authorSeq++ % 26))}`);
        return authorTags.get(key);
    };

    for (const [pi, p] of people.entries()) {
        let msgs = utils?.getMessagesBySender?.(p.jid, p.alias, msgLimit) || [];
        let approx = false;
        const rawLabel = p.nameHint || displayName(msgs[msgs.length - 1] || {}, p.jid);
        let label = safePersonLabel(rawLabel, personTag(pi, people.length));
        const msgGroups = [];
        // Presença na atividade (quem fala mas nunca usou comando): dá o nome
        // e mostra em quais grupos a pessoa aparece, mesmo sem conteúdo.
        let presence = null;
        try {
            presence = utils?.findActivityName?.(p.jid, p.alias) || null;
        } catch (_) {}
        if ((!label || /^(pessoa mencionada|pessoa [A-Z])$/.test(label)) && presence?.name) {
            label = safePersonLabel(presence.name, personTag(pi, people.length));
        }
        // Fallback: sem log do painel, busca pelo nome no histórico geral
        // (tabela messages — atribuição aproximada por push_name).
        // AGREGA TODOS OS GRUPOS: a pessoa pode falar em vários.
        if (msgs.length === 0) {
            try {
                let pname = (label && !/^(pessoa mencionada|pessoa [A-Z])$/.test(label)) ? label : null;
                if (!pname) pname = utils?.getSenderName?.(p.jid) || utils?.getSenderName?.(p.alias) || null;
                if (!pname && presence?.name) pname = presence.name;
                if (pname) {
                    const scope = groupJids.length > 0 ? [...groupJids, null] : [null];
                    const collected = [];
                    const likeFn = utils?.findMessagesByNameLike || utils?.getMessagesByPushName;
                    for (const gj of scope) {
                        const extra = likeFn?.call(utils, gj, pname, msgLimit) || [];
                        // usa o jid real da linha (o escopo nulo mistura grupos)
                        for (const r of extra) collected.push({ gj: r.jid || gj, r });
                        if (collected.length >= msgLimit * 2) break;
                    }
                    if (collected.length > 0) {
                        collected.sort((a, b) => (a.r.time || 0) - (b.r.time || 0));
                        for (const c of collected) c.gname = await groupName(c.gj);
                        const distinctGroups = [...new Set(collected.map((c) => c.gj || ''))].filter(Boolean);
                        const multi = distinctGroups.length > 1;
                        for (const gj of distinctGroups) {
                            const gname = await groupName(gj);
                            if (!msgGroups.includes(gname)) msgGroups.push(gname);
                        }
                        msgs = collected.slice(-msgLimit).map(({ gj, r, gname }) => {
                            const gtag = multi ? `(${clean(gname || 'grupo', 25)}) ` : '';
                            return { text: `${gtag}${r.text}`, name: r.push_name, timestamp: r.time };
                        });
                        approx = true;
                        if (msgs.length > 0) label = safePersonLabel(pname, personTag(pi, people.length));
                    }
                }
            } catch (_) {}
        }
        // advs nos grupos relevantes
        const advParts = [];
        for (const gj of groupJids) {
            const c = warningsOf(utils, gj, p.jid);
            if (c > 0) advParts.push(`${c}/3 (${clean(await groupName(gj), 25)})`);
        }
        const where = msgGroups.length > 1 ? ` em ${msgGroups.length} grupos` : '';
        const presenceNote = (msgs.length === 0 && presence && presence.total > 0)
            ? ` — aparece em ${presence.groups.length} grupo(s), ${presence.total} msgs contadas (sem conteúdo salvo)`
            : '';
        lines.push(`Pessoa: ${clean(label, 30)} — advs: ${advParts.length ? advParts.join(', ') : 'nenhuma'} — ${msgs.length} msgs recentes${where}${approx ? ' (aproximado por nome)' : ''}${presenceNote}:`);
        for (const ml of msgs.slice(-msgLimit)) {
            const txt = clean(ml.text, msgChars);
            if (txt) lines.push(`  [${fmtWhen(ml.timestamp)}] ${txt}`);
        }
        stats.people.push({ jid: p.jid, label, advs: advParts, msgCount: msgs.length, approx, groups: msgGroups, presence });
        resoParts.push(isTagLabel(label) ? `${label} (nome não confirmado)` : `${label} (identidade confirmada pelo bot)`);
    }

    for (const g of groups) {
        let msgs = utils?.getMessagesByGroup?.(g.jid, 20) || [];
        let approx = false;
        // Fallback: histórico geral do grupo (autores por push_name).
        if (msgs.length === 0) {
            try {
                const extra = utils?.getGroupMessages?.(g.jid, 20) || [];
                if (extra.length > 0) {
                    msgs = extra.map((r) => ({ text: r.text, name: r.push_name, senderJid: null, timestamp: r.time }));
                    approx = true;
                }
            } catch (_) {}
        }
        const gname = clean(await groupName(g.jid) || g.subject, 50);
        lines.push(`Grupo: ${gname} — ${msgs.length} msgs recentes${approx ? ' (autores por nome)' : ''}:`);
        for (const ml of msgs.slice(-20)) {
            const txt = clean(ml.text, groupMsgChars);
            if (txt) lines.push(`  [${fmtWhen(ml.timestamp)}] ${authorLabel(ml)}: ${txt}`);
        }
        let top = null;
        try { top = utils?.getTopMember?.(g.jid) || null; } catch (_) {}
        if (top && !/nenhum registro/i.test(String(top))) lines.push(`  Top do grupo hoje: ${clean(top, 30)}`);
        stats.groups.push({ jid: g.jid, subject: gname, msgCount: msgs.length, top, approx });
    }

    // Logs do próprio bot (só quando a pergunta é sobre isso).
    if (wantsLogs(question)) {
        try {
            const errors = utils?.getRecentLogs?.('error', 10) || [];
            const actions = (utils?.getRecentLogs?.('action', 30) || [])
                .filter((l) => /comando executado/i.test(l.text || ''))
                .slice(-10);
            if (errors.length > 0) {
                lines.push(`Erros recentes (${errors.length}):`);
                for (const el of errors) {
                    const txt = clean(el.text, 140);
                    if (txt) lines.push(`  [${fmtWhen(el.timestamp)}] ${txt}`);
                }
            } else {
                lines.push('Erros recentes: nenhum no histórico.');
            }
            if (actions.length > 0) {
                lines.push(`Comandos executados recentemente (${actions.length}):`);
                for (const al of actions) {
                    const txt = clean(al.text, 120);
                    if (txt) lines.push(`  [${fmtWhen(al.timestamp)}] ${txt}`);
                }
            }
            stats.logs = {
                errors: errors.map((e) => ({ when: e.timestamp, text: e.text })),
                commands: actions.map((a) => ({ when: a.timestamp, text: a.text }))
            };
        } catch (_) {}
    }

    if (resoParts.length > 0) {
        lines.unshift(`Alvos da pergunta (resolvidos pelo bot): ${resoParts.join('; ')}.`);
    }

    const text = lines.join('\n').slice(0, 2800);
    return { text, stats };
}

// Evidência vazia de verdade: ninguém com msg/adv, nenhum grupo com msg,
// sem logs. Chamar a IA aqui só gera resposta genérica — melhor "sem dados".
function evidenceIsEmpty(stats) {
    if (!stats) return true;
    const peopleEmpty = (stats.people || []).every((p) => (p.msgCount || 0) === 0 && (p.advs || []).length === 0 && !((p.presence?.total || 0) > 0));
    const groupsEmpty = (stats.groups || []).every((g) => (g.msgCount || 0) === 0 && !g.top);
    const logsEmpty = !stats.logs || (((stats.logs.errors || []).length === 0) && ((stats.logs.commands || []).length === 0));
    const hasTargets = (stats.people || []).length > 0 || (stats.groups || []).length > 0;
    return hasTargets ? (peopleEmpty && groupsEmpty && logsEmpty) : logsEmpty;
}

// Fast-path determinístico (sem IA). Retorna string ou null.
function matchFactual(question, evidence, { isGroup, from, utils } = {}) {
    const q = String(question || '').toLowerCase();
    if (!evidence) return null;

    const wantsAdv = /adv|advertênc|punid|warn/.test(q);
    const wantsCount = /quantas?\s+mensagen|qtd.*mensagen|quantidade.*mensagen/.test(q);
    const wantsTop = /quem mais|mais fala|mais ativ|top\b/.test(q);

    if (wantsAdv && evidence.stats.people.length > 0) {
        const parts = evidence.stats.people.map((p) =>
            `• ${p.label}: ${p.advs.length ? p.advs.join(', ') : 'nenhuma advertência'}`);
        return `⚠️ *Advertências*\n${parts.join('\n')}`;
    }
    if (wantsAdv && evidence.stats.groups.length > 0) {
        // top advs do grupo
        try {
            const gd = utils?.getGroupData?.(evidence.stats.groups[0].jid) || {};
            const w = gd.warnings || {};
            const entries = Object.entries(w).filter(([, c]) => (Number(c) || 0) > 0)
                .sort((a, b) => b[1] - a[1]).slice(0, 10);
            if (entries.length === 0) return '✅ Ninguém tem advertências neste grupo.';
            return '⚠️ *Advertências ativas*\n' + entries.map(([jid, c], i) => `${i + 1}. @${String(jid).split('@')[0]} — ${c}/3`).join('\n');
        } catch (_) { return null; }
    }
    if (wantsCount && evidence.stats.people.length > 0) {
        const parts = evidence.stats.people.map((p) => `• ${p.label}: ${p.msgCount} mensagens recentes`);
        return `💬 *Mensagens (janela do histórico)*\n${parts.join('\n')}`;
    }
    if (wantsTop) {
        const gj = evidence.stats.groups[0]?.jid || (isGroup ? from : null);
        if (gj) {
            try {
                const top = utils?.getTopMember?.(gj);
                if (top) return `🏆 *Quem mais fala:* ${top}`;
            } catch (_) {}
        }
    }
    // Logs: erros e comandos recentes (R$0, direto do banco).
    if (evidence.stats.logs) {
        if (/erro|falha|bug|travou|parou|quebrou/i.test(q)) {
            const errs = evidence.stats.logs.errors || [];
            if (errs.length === 0) return '✅ Nenhum erro registrado no histórico.';
            return '❌ *Erros recentes*\n' + errs.map((e) => `• ${clean(e.text, 140)}`).join('\n');
        }
        if (/comando|rodou|execut|usou|atividade do bot/i.test(q)) {
            const cmds = evidence.stats.logs.commands || [];
            if (cmds.length === 0) return 'ℹ️ Nenhum comando registrado no histórico.';
            return '🤖 *Comandos executados recentemente*\n' + cmds.map((c) => `• ${clean(c.text, 120)}`).join('\n');
        }
    }
    return null;
}

module.exports = { resolveTargets, buildEvidence, matchFactual, clean, warningsOf, wantsLogs, safePersonLabel, personTag, displayName, jidFromDigits, digitsOf, evidenceIsEmpty };
