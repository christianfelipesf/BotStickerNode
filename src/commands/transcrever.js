const { parseTranscribeArgs, transcribeAudioMessage } = require('../services/transcribe');

module.exports = {
    name: 'transcrever',
    aliases: ['transcribe', 'transcricao', 'transcreva'],
    category: 'mídia',
    description: 'Transcreve áudio/vídeo em texto (marque o áudio ou envie com legenda)',
    async execute(sock, m, { from, args, config, utils, lastBotResponse, GLOBAL_COOLDOWN, abortSignal, log }) {
        const { react, reactStatus } = utils;

        const { language } = parseTranscribeArgs(args);
        let currentBotResponse = await react(sock, m, '📝', lastBotResponse, GLOBAL_COOLDOWN);

        try {
            const { text, provider } = await transcribeAudioMessage(sock, from, m, {
                config, utils, language, signal: abortSignal, log
            });
            await sock.sendMessage(from, { text: `📝 *Transcrição${language !== 'pt' ? ` (${language})` : ''}:*\n\n${text}` }, { quoted: m });
            try { log?.('ok', provider); } catch (_) {}
            return await reactStatus(sock, m, from, true, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (e) {
            if (e?.code === 'ABORTED' || abortSignal?.aborted) return currentBotResponse;
            const msg = String(e?.message || 'Erro desconhecido').slice(0, 300);
            console.error('❌ [TRANSCREVER] Erro:', e?.response?.data || e.message || e);
            await sock.sendMessage(from, { text: `❌ ${msg}` }, { quoted: m });
            return await reactStatus(sock, m, from, false, '✅', '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }
    }
};
