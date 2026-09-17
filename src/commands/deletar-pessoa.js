const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'deletar-pessoa',
    aliases: ['delficha', 'del-ficha', 'remover-pessoa', 'delpessoa', 'deletar-ficha'],
    category: 'geral',
    description: 'Remove ficha: !deletar-pessoa Nome confirmar',
    async execute(sock, m, { from, config, utils, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getPessoa, deletePessoa } = utils;
        let current = await react(sock, m, '🗑️', lastBotResponse, GLOBAL_COOLDOWN);
        const raw = String(fullArgsText || '').trim();
        if (!raw) {
            await sock.sendMessage(from, { text: `🗑️ *Deletar ficha*\n\nUse:\n*${config.prefix}deletar-pessoa Nome confirmar*` }, { quoted: m });
            return current;
        }
        const confirm = /\bconfirmar\b/i.test(raw);
        const nome = raw.replace(/\bconfirmar\b/i, '').trim();
        if (!nome) {
            await sock.sendMessage(from, { text: '❌ Informe o nome. Ex: *!deletar-pessoa Eduarda confirmar*' }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        const prev = getPessoa(nome);
        if (!prev) {
            await sock.sendMessage(from, { text: `❌ Ficha *${nome.slice(0, 40)}* não encontrada.` }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        if (!confirm) {
            await sock.sendMessage(from, { text: `⚠️ Confirme a exclusão de *${prev.nome}*:\n*${config.prefix}deletar-pessoa ${prev.nome} confirmar*` }, { quoted: m });
            return current;
        }
        // apaga foto do disco (best effort)
        try {
            if (prev.foto_path) {
                const full = path.resolve(process.cwd(), prev.foto_path);
                if (full.startsWith(path.resolve(process.cwd(), 'uploads') + path.sep) && fs.existsSync(full)) fs.unlinkSync(full);
            }
        } catch (_) {}
        const ok = deletePessoa(prev.nome);
        if (!ok) {
            await sock.sendMessage(from, { text: '❌ Falha ao deletar.' }, { quoted: m });
            return await react(sock, m, '❌', current, GLOBAL_COOLDOWN);
        }
        await sock.sendMessage(from, { text: `🗑️ Ficha *${prev.nome}* deletada.` }, { quoted: m });
        return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
    }
};
