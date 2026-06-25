module.exports = {
    name: 'tutorial',
    aliases: ['tut', 'guia', 'howto'],
    category: 'geral',
    description: 'Mostra um tutorial básico de uso do bot',
    async execute(sock, m, { from, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getBotName } = utils;

        let currentBotResponse = await react(sock, m, '📚', lastBotResponse, GLOBAL_COOLDOWN);
        const currentBotName = getBotName(from, config);
        const p = config.prefix;

        const tutorial = `📚 *Tutorial — ${currentBotName}*\n\n` +
            `O bot responde a comandos que começam com *${p}*.\n\n` +
            `╭── *1. CONHECER OS COMANDOS* ──\n` +
            `│ ${p}menu — lista todos os comandos\n` +
            `│ ${p}status — ver prefixo, uptime e contadores\n` +
            `╰─────────────────────────────\n\n` +
            `╭── *2. STICKERS* ──\n` +
            `│ Envie uma *imagem ou vídeo* com legenda ${p}s para criar sticker\n` +
            `│ Marque um sticker com ${p}toimg para voltar a imagem\n` +
            `│ ${p}revelar — recupera view-once (fotos/vídeos que somem)\n` +
            `╰─────────────────────────────\n\n` +
        `╭── *3. MÍDIA & DOWNLOAD* ──\n` +
        `│ ${p}play <nome> — baixa música do YouTube (max 15min)\n` +
        `│ ${p}dl <link> — baixa vídeo (TikTok, IG, YouTube…)\n` +
        `│ ${p}dhd <link> — versão HD do !d\n` +
        `│ ${p}tts <texto> — fala um texto em áudio\n` +
        `│ ${p}acelerar / ${p}desacelerar — ajusta velocidade do áudio\n` +
        `╰─────────────────────────────\n\n` +
        `⏱️ *Limite:* ${p}play e ${p}d (YouTube) baixam no máximo *15 minutos* (configurável com \`${p}set maxMediaDurationSeconds <s>\`).\n\n` +
            `╭── *4. INTELIGÊNCIA ARTIFICIAL* ──\n` +
            `│ ${p}ai <pergunta> — converse com a IA (Gemini)\n` +
            `│ ${p}resumir <n> — resume as últimas mensagens do grupo\n` +
            `╰─────────────────────────────\n\n` +
            `╭── *5. GRUPOS* ──\n` +
            `│ ${p}ativar — liga o bot no grupo\n` +
            `│ ${p}desativar — desliga o bot no grupo\n` +
            `│ ${p}ban (marque) — remove membro\n` +
            `│ ${p}antilink — liga/desliga remoção de links\n` +
            `╰─────────────────────────────\n\n` +
            `╭── *6. CONFIGURAR* ──\n` +
            `│ ${p}config — abre o painel de configurações\n` +
            `│ ${p}setprefix <símbolo> — muda o prefixo\n` +
            `│ ${p}set <chave> <valor> — ajusta parâmetros\n` +
            `╰─────────────────────────────\n\n` +
            `💡 *Dica:* o bot só responde em grupos após alguém usar ${p}ativar.`;

        await sock.sendMessage(from, { text: tutorial }, { quoted: m });
        return currentBotResponse;
    }
};
