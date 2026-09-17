module.exports = {
    name: 'enquete',
    aliases: ['poll', 'votacao', 'votação', 'enquetes', 'vote'],
    description: 'Cria enquete nativa. Ex: !enquete Qual dia? | sexta ; sábado ; domingo',
    category: 'admin',
    async execute(sock, m, { from, isGroup, sender, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        if (!isGroup) return await sock.sendMessage(from, { text: '❌ Este comando só funciona em grupos.' }, { quoted: m });

        const admins = await utils.getAdmins(sock, from);
        if (!utils.isUserAdmin(sender, admins)) {
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem criar enquetes.' }, { quoted: m });
        }

        const full = (args || []).join(' ').trim();
        const barIdx = full.indexOf('|');
        if (barIdx < 0) {
            return await sock.sendMessage(from, { text: '❌ Use: !enquete <pergunta> | <op1> ; <op2> ; <op3>\nEx: !enquete Qual dia do churrasco? | sexta ; sábado ; domingo' }, { quoted: m });
        }
        const question = full.slice(0, barIdx).trim().replace(/^["“”']+|["“”']+$/g, '').trim();
        const options = full.slice(barIdx + 1).split(';').map(s => s.trim().replace(/^["“”']+|["“”']+$/g, '').trim()).filter(Boolean);

        if (!question || question.length < 2) {
            return await sock.sendMessage(from, { text: '❌ Informe a pergunta da enquete.' }, { quoted: m });
        }
        if (options.length < 2) {
            return await sock.sendMessage(from, { text: '❌ Informe ao menos 2 opções separadas por ;' }, { quoted: m });
        }
        if (options.length > 12) {
            return await sock.sendMessage(from, { text: '❌ Máximo de 12 opções.' }, { quoted: m });
        }
        if (question.length > 300 || options.some(o => o.length > 100)) {
            return await sock.sendMessage(from, { text: '❌ Pergunta (máx 300) ou opção (máx 100) muito longa.' }, { quoted: m });
        }

        try {
            await sock.sendMessage(from, { poll: { name: question, values: options, selectableCount: 1 } }, { quoted: m });
            await utils.react(sock, m, '📊', lastBotResponse, GLOBAL_COOLDOWN);
        } catch (e) {
            return await sock.sendMessage(from, { text: '❌ Não consegui criar a enquete.' }, { quoted: m });
        }
    }
};
