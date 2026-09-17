const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { parseCadastroPipe, parseNascimento, formatFicha, FICHA_LIMITS } = require('../services/ficha');

module.exports = {
    name: 'cadastrar-pessoa',
    aliases: ['cadastrar', 'addpessoa', 'add-ficha', 'novaficha', 'cadastrar-ficha'],
    category: 'geral',
    description: 'Cadastra ficha: !cadastrar-pessoa Nome | 15/08/2000 | Cidade | Descrição (responda foto)',
    async execute(sock, m, { from, sender, config, utils, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, upsertPessoa, countPessoas, saveFichaPhoto, getMediaMessage } = utils;
        let current = await react(sock, m, '📝', lastBotResponse, GLOBAL_COOLDOWN);

        const parsed = parseCadastroPipe(fullArgsText);
        if (!parsed.nome) {
            await sock.sendMessage(from, {
                text: `📝 *Cadastrar pessoa*\n\nUse (responda a foto para incluir):\n*${config.prefix}cadastrar-pessoa Nome | 15/08/2000 | Cidade | Descrição*\n\nOpcionais: *| Status | Hobby* ou *| pix=... | instagram=@... | linkedin=...*\nEx:\n*${config.prefix}cadastrar-pessoa Eduarda | 15/08/2000 | São Paulo - SP | Fã de café*`
            }, { quoted: m });
            return current;
        }
        const nome = String(parsed.nome).trim().slice(0, FICHA_LIMITS.nome);
        if (nome.length < 2) {
            await sock.sendMessage(from, { text: '❌ Nome muito curto (mín. 2 letras).' }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        try {
            const { isValidPessoaNome } = require('../services/ficha');
            const check = isValidPessoaNome(nome);
            if (!check.ok) {
                await sock.sendMessage(from, { text: `❌ ${check.reason}\n\nEx: *${config.prefix}cadastrar-pessoa Maria Silva | 15/08/2000 | São Paulo - SP | ...*` }, { quoted: m });
                return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
            }
        } catch (_) {}
        if (countPessoas() >= 500) {
            await sock.sendMessage(from, { text: '❌ Limite de 500 fichas atingido.' }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }

        let nascimento = null;
        if (parsed.nascimento) {
            nascimento = parseNascimento(parsed.nascimento);
            if (!nascimento) {
                await sock.sendMessage(from, { text: '❌ Data inválida. Use *DD/MM/AAAA* (ex: 15/08/2000).' }, { quoted: m });
                return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
            }
        }
        const clean = (v, lim) => (v == null ? null : String(v).trim().slice(0, lim) || null);
        const data = {
            nome,
            nascimento,
            cidade: clean(parsed.cidade, FICHA_LIMITS.cidade),
            descricao: clean(parsed.descricao, FICHA_LIMITS.descricao),
            status: clean(parsed.status, FICHA_LIMITS.status),
            hobby: clean(parsed.hobby, FICHA_LIMITS.hobby),
            pix: clean(parsed.pix, FICHA_LIMITS.pix),
            instagram: clean(parsed.instagram, FICHA_LIMITS.instagram),
            linkedin: clean(parsed.linkedin, FICHA_LIMITS.linkedin),
            created_by: sender || null
        };

        // Foto: mensagem citada (prioridade) ou a própria mensagem com imagem
        try {
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const quotedMsg = ctx?.quotedMessage;
            let imgMedia = null;
            let targetKey = null;
            let targetMsg = null;
            if (quotedMsg) {
                const qm = getMediaMessage(quotedMsg);
                if (qm && qm.imageMessage) {
                    imgMedia = qm.imageMessage;
                    targetKey = { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant || from, fromMe: false };
                    targetMsg = { key: targetKey, message: quotedMsg };
                }
            }
            if (!imgMedia) {
                const own = getMediaMessage(m.message);
                if (own && own.imageMessage) {
                    imgMedia = own.imageMessage;
                    targetMsg = m;
                }
            }
            if (imgMedia && targetMsg) {
                current = await react(sock, m, '⏳', current, GLOBAL_COOLDOWN);
                const buf = await downloadMediaMessage(targetMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }).catch(() => null);
                if (buf && buf.length > 100) {
                    const fichaNorm = require('../services/ficha').normalizeNome(nome);
                    data.foto_path = await saveFichaPhoto(buf, fichaNorm);
                }
            }
        } catch (e) {
            console.warn(`⚠️ [cadastrar-pessoa] foto ignorada: ${e.message}`);
        }

        const res = upsertPessoa(data);
        if (!res.ok) {
            await sock.sendMessage(from, { text: `❌ Falha ao salvar: ${res.error}` }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        const saved = utils.getPessoa(nome);
        const caption = formatFicha(saved || { nome, nascimento, cidade: data.cidade, descricao: data.descricao, status: data.status, hobby: data.hobby }, getBotName(from, config));
        const { readFotoBuffer } = require('../services/ficha');
        const buf = saved ? readFotoBuffer(saved.foto_path) : null;
        const prefix = res.created ? '✅ *Ficha cadastrada!*' : '🔄 *Ficha atualizada!*';
        if (buf) await sock.sendMessage(from, { image: buf, caption: `${prefix}\n\n${caption}` }, { quoted: m });
        else await sock.sendMessage(from, { text: `${prefix}\n\n${caption}\n│ 🖼️ *Foto:* responda uma foto com o comando para incluir` }, { quoted: m });
        return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
    }
};
