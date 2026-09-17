const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { parseNascimento, formatFicha, FICHA_FIELDS, FICHA_LIMITS } = require('../services/ficha');

module.exports = {
    name: 'editar-pessoa',
    aliases: ['editarficha', 'editar-ficha', 'update-pessoa', 'editar'],
    category: 'geral',
    description: 'Edita ficha: !editar-pessoa Nome | campo=valor | ...',
    async execute(sock, m, { from, config, utils, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, getPessoa, updatePessoa, saveFichaPhoto, getMediaMessage } = utils;
        let current = await react(sock, m, '✏️', lastBotResponse, GLOBAL_COOLDOWN);
        const raw = String(fullArgsText || '').trim();
        if (!raw) {
            await sock.sendMessage(from, {
                text: `✏️ *Editar ficha*\n\nUse:\n*${config.prefix}editar-pessoa Nome | cidade=Nova Cidade | hobby=X*\n\nCampos: nome, nascimento (DD/MM/AAAA), cidade, descricao, status, hobby, pix, instagram, linkedin\nFoto nova: responda uma imagem com o comando + *| foto=sim*`
            }, { quoted: m });
            return current;
        }
        const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
        const nome = parts.shift();
        const prev = getPessoa(nome);
        if (!prev) {
            await sock.sendMessage(from, { text: `❌ Ficha *${String(nome).slice(0, 40)}* não encontrada.` }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        const patch = {};
        for (const part of parts) {
            const mt = part.match(/^(nome|nascimento|data|cidade|descricao|descrição|status|hobby|pix|instagram|insta|linkedin|foto)\s*[:=]\s*(.+)$/i);
            if (!mt) continue;
            let k = mt[1].toLowerCase();
            if (k === 'data') k = 'nascimento';
            if (k === 'descrição') k = 'descricao';
            if (k === 'insta') k = 'instagram';
            if (k === 'foto') continue; // só marcador, download abaixo
            if (!FICHA_FIELDS.has(k)) continue;
            let v = mt[2].trim();
            if (k === 'nascimento') {
                const iso = parseNascimento(v);
                if (!iso) {
                    await sock.sendMessage(from, { text: '❌ Data inválida. Use *DD/MM/AAAA*.' }, { quoted: m });
                    return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
                }
                patch[k] = iso;
            } else {
                patch[k] = v.slice(0, FICHA_LIMITS[k]) || null;
            }
        }
        // Foto nova via reply/imagem
        try {
            const ctx = m.message?.extendedTextMessage?.contextInfo;
            const quotedMsg = ctx?.quotedMessage;
            let targetMsg = null;
            if (quotedMsg && getMediaMessage(quotedMsg)?.imageMessage) {
                targetMsg = { key: { remoteJid: from, id: ctx.stanzaId, participant: ctx.participant || from, fromMe: false }, message: quotedMsg };
            } else if (getMediaMessage(m.message)?.imageMessage) {
                targetMsg = m;
            }
            if (targetMsg) {
                const buf = await downloadMediaMessage(targetMsg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }).catch(() => null);
                if (buf && buf.length > 100) {
                    const fichaNorm = require('../services/ficha').normalizeNome(patch.nome || prev.nome);
                    patch.foto_path = await saveFichaPhoto(buf, fichaNorm);
                }
            }
        } catch (e) {
            console.warn(`⚠️ [editar-pessoa] foto ignorada: ${e.message}`);
        }
        if (Object.keys(patch).length === 0) {
            await sock.sendMessage(from, { text: '❌ Nada para alterar. Ex: *!editar-pessoa Eduarda | cidade=Curitiba*' }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        const res = updatePessoa(prev.nome, patch);
        if (!res.ok) {
            await sock.sendMessage(from, { text: `❌ Falha: ${res.error || 'erro desconhecido'}` }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        const saved = getPessoa(patch.nome || prev.nome) || prev;
        const caption = formatFicha(saved, getBotName(from, config));
        const { readFotoBuffer } = require('../services/ficha');
        const buf = readFotoBuffer(saved.foto_path);
        if (buf) await sock.sendMessage(from, { image: buf, caption: `✅ *Ficha atualizada!*\n\n${caption}` }, { quoted: m });
        else await sock.sendMessage(from, { text: `✅ *Ficha atualizada!*\n\n${caption}` }, { quoted: m });
        return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
    }
};
