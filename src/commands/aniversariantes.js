const { formatNascimento, calcIdade } = require('../services/ficha');

function currentMonthBRT() {
    try {
        const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', month: '2-digit' }).formatToParts(new Date());
        return parts.find(p => p.type === 'month')?.value || String(new Date().getMonth() + 1).padStart(2, '0');
    } catch (_) { return String(new Date().getMonth() + 1).padStart(2, '0'); }
}

const MESES = { '01': 'janeiro', '02': 'fevereiro', '03': 'março', '04': 'abril', '05': 'maio', '06': 'junho', '07': 'julho', '08': 'agosto', '09': 'setembro', '10': 'outubro', '11': 'novembro', '12': 'dezembro' };

module.exports = {
    name: 'aniversariantes',
    aliases: ['niver', 'aniversarios', 'niveres', 'aniversariante'],
    category: 'geral',
    description: 'Mostra aniversariantes do mês (!aniversariantes [MM])',
    async execute(sock, m, { from, config, utils, fullArgsText, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName, aniversariantes } = utils;
        let current = await react(sock, m, '🎂', lastBotResponse, GLOBAL_COOLDOWN);
        let mm = String(fullArgsText || '').trim().replace(/\D/g, '').slice(0, 2);
        if (mm.length === 1) mm = '0' + mm;
        if (!/^(0[1-9]|1[0-2])$/.test(mm)) mm = currentMonthBRT();
        const rows = aniversariantes(mm);
        const label = MESES[mm] || mm;
        if (!rows.length) {
            await sock.sendMessage(from, { text: `🎂 *Aniversariantes de ${label}*\n\n_Ninguém cadastrado neste mês._\n\n💡 *${config.prefix}cadastrar-pessoa Nome | 15/08/2000 | Cidade | ...*` }, { quoted: m });
            return current;
        }
        let txt = `╭─── *🎂 ANIVERSARIANTES — ${label}* ───\n`;
        for (const p of rows) {
            const dia = String(p.nascimento || '').slice(8, 10);
            const idade = calcIdade(p.nascimento);
            txt += `│ 🎈 dia ${dia} — *${p.nome}* (${formatNascimento(p.nascimento)}${idade != null ? `, ${idade} anos` : ''})\n`;
        }
        txt += `│ 🤖 *Por:* ${getBotName(from, config)}\n╰───────────────`;
        await sock.sendMessage(from, { text: txt }, { quoted: m });
        return await react(sock, m, '✅', current, GLOBAL_COOLDOWN);
    }
};
