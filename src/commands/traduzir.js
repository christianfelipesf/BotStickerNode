const axios = require('axios');

const LANG_CODES = new Set(['pt','en','es','fr','de','it','ja','zh','ru','ar','ko','nl','pl','sv','tr','th','vi','hi','id','ms','ro','cs','hu','fi','da','el','he','no','uk','bg','sr','hr','sk','lt','lv','et','sl','ca','gl','eu','fa','ur','sw','ta','te','mr','bn','gu','kn','ml','pa','ne','si','km','lo','my','ka','hy','az','be','is','ga','cy','sq','mk','bs','mn','af','zu','xh','st','tn','ss','ts','jw','su','ceb','mg','ny','ha','so','ig','yo','rw','sn','am','ps','ku','sd','ug','bo','dz','sm','to','mi','fj','ht','co','la','yi','ast','nd','nr','ve','sg','ii','ff','sa','or','as','ks','kok','doi','lus','brx','kha','new','kru','mis']);

module.exports = {
    name: 'traduzir',
    aliases: ['translate', 'trad', 'traduz'],
    category: 'utilidades',
    description: 'Traduz texto ou mensagem marcada (padrão: português)',
    async execute(sock, m, { from, args, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getMessageText } = utils;

        let text = args.join(' ').trim();
        let targetLang = 'pt';

        if (text) {
            const maybe = text.split(/\s+/)[0].toLowerCase();
            if (LANG_CODES.has(maybe)) {
                targetLang = maybe;
                text = text.substring(maybe.length).trim();
            }
        }

        if (!text && m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            text = getMessageText(m.message.extendedTextMessage.contextInfo.quotedMessage);
        }
        if (!text) {
            text = getMessageText(m.message);
        }

        if (!text || text.length === 0) {
            return await sock.sendMessage(from, { text: '❌ Digite o texto ou marque uma mensagem para traduzir.' }, { quoted: m });
        }

        if (text.length > 2000) {
            return await sock.sendMessage(from, { text: '❌ Texto muito longo. Máximo 2000 caracteres.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '🌐', lastBotResponse, GLOBAL_COOLDOWN);

        try {
            const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
                params: {
                    client: 'gtx',
                    sl: 'auto',
                    tl: targetLang,
                    dt: 't',
                    q: text
                },
                timeout: 10000
            });

            const translated = data[0].map(r => r[0]).join('');

            await sock.sendMessage(from, {
                text: `🌐 *Tradução:*\n\n${translated}`
            }, { quoted: m });

            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (error) {
            console.error('❌ [TRADUZIR] Erro:', error.message);
            await sock.sendMessage(from, { text: '❌ Erro ao traduzir. Tente novamente.' }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
