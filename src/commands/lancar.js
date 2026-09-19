const { getInteractionVideoMedia, getInteractionDir } = require('../services/interaction');

function getContextInfo(m) {
    const msg = m?.message || {};
    return (
        msg.extendedTextMessage?.contextInfo ||
        msg.imageMessage?.contextInfo ||
        msg.videoMessage?.contextInfo ||
        msg.stickerMessage?.contextInfo ||
        msg.documentMessage?.contextInfo ||
        msg.audioMessage?.contextInfo ||
        null
    );
}

// Poderes disponíveis — para adicionar novos no futuro, basta acrescentar aqui + pasta em src/media/interacoes/<dir>.
const PODERES = {
    fogo:  { emoji: '🔥', nome: 'FOGO',  verbo: 'lançou 🔥 FOGO em',   dir: 'lancar_fogo' },
    agua:  { emoji: '💧', nome: 'ÁGUA',  verbo: 'lançou 💧 ÁGUA em',   dir: 'lancar_agua' },
    pedra: { emoji: '🪨', nome: 'PEDRA', verbo: 'lançou 🪨 PEDRA em',  dir: 'lancar_pedra' },
    laser: { emoji: '🔫', nome: 'LASER', verbo: 'lançou 🔫 LASER em',  dir: 'lancar_laser' },
    raio:  { emoji: '⚡', nome: 'RAIO',  verbo: 'lançou ⚡ RAIO em',   dir: 'lancar_raio' },
};

// Normaliza: minúsculo, sem acento. "água"->"agua", "lazer"->"laser".
function normPoder(s) {
    if (!s) return '';
    return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function resolvePoder(raw) {
    const p = normPoder(raw);
    if (!p) return null;
    if (p === 'lazer') return PODERES.laser; // alias de laser
    return PODERES[p] || null;
}

module.exports = {
    name: 'lancar',
    aliases: ['lançar', 'jogar', 'lansar'],
    category: 'interação',
    description: 'Lança um poder (fogo, agua, pedra, laser) em um usuário',
    poderes: PODERES,
    async execute(sock, m, { from, sender, args, utils, lastBotResponse, GLOBAL_COOLDOWN, log }) {
        const { react } = utils;
        const say = (...a) => { try { if (typeof log === 'function') log(...a); } catch (_) {} };
        const poderRaw = (args && args[0]) || '';
        const poder = resolvePoder(poderRaw);
        const emoji = poder ? poder.emoji : '✨';

        let current = await react(sock, m, emoji, lastBotResponse, GLOBAL_COOLDOWN);

        if (!poder) {
            const lista = Object.values(PODERES).map((p) => `${p.emoji} *${p.nome.toLowerCase()}*`).join(' • ');
            await sock.sendMessage(from, {
                text: `❌ Poder inválido! Use:\n\`!lancar <poder> @user\`\n\n*Poderes:* ${lista}\n\nEx: \`!lancar fogo @Maria\` (ou responda a mensagem dela com \`!lancar fogo\`)`
            }, { quoted: m });
            return current;
        }

        try {
            const ctx = getContextInfo(m);
            const mentionedJid = ctx?.mentionedJid?.[0] || null;
            const quotedParticipant = ctx?.participant || null;
            let targetJid = mentionedJid || quotedParticipant || null;
            if (!targetJid) {
                await sock.sendMessage(from, { text: `❌ Marque alguém: \`!lancar ${poder.nome.toLowerCase()} @user\` ou responda a mensagem da pessoa com \`!lancar ${poder.nome.toLowerCase()}\`.` }, { quoted: m });
                return current;
            }
            if (targetJid === sender) {
                await sock.sendMessage(from, { text: `😅 Você não pode lançar ${poder.nome} em si mesmo! Marque outra pessoa.` }, { quoted: m });
                return current;
            }

            let media = null;
            try { media = await getInteractionVideoMedia(poder.dir); } catch (e) { console.error(`❌ [lancar:${poder.dir}] mídia local falhou:`, e.message); say('mídia falhou', e.message); }
            if (!media) {
                console.warn(`⚠️ [lancar:${poder.dir}] pasta vazia: coloque um .gif/.mp4 em ${getInteractionDir(poder.dir)}`);
                say('pasta vazia', getInteractionDir(poder.dir));
            } else {
                say('mídia', `${media.ext} ${Math.round(media.buffer.length / 1024)}KB`);
            }

            const isLid = (jid) => typeof jid === 'string' && jid.endsWith('@lid');
            const isGenericName = (n) => !n || ['usuario', 'usuário'].includes(String(n).trim().toLowerCase());
            const cleanName = (n) => String(n).trim().slice(0, 30);

            async function resolveMention(jid, fallbackName) {
                if (!jid) return { text: '*Usuário*', jid: null, hasMention: false };
                if (!isLid(jid)) {
                    const ph = String(jid).split('@')[0].split(':')[0];
                    if (/^\d{8,15}$/.test(ph)) return { text: `@${ph}`, jid, hasMention: true };
                    if (fallbackName && !isGenericName(fallbackName)) return { text: `*${cleanName(fallbackName)}*`, jid, hasMention: false };
                    return { text: '*Usuário*', jid: null, hasMention: false };
                }
                const lidPart = String(jid).split('@')[0];
                return { text: `@${lidPart}`, jid, hasMention: true };
            }

            const senderFallback = m.pushName || null;
            let targetFallback = null;
            try {
                targetFallback = await utils.getGroupParticipantName(sock, from, targetJid, null).catch(() => null);
                if (isGenericName(targetFallback)) targetFallback = null;
            } catch (_) {}
            if (!targetFallback) targetFallback = ctx?.pushName || null;

            const senderDisp = await resolveMention(sender, senderFallback);
            const targetDisp = await resolveMention(targetJid, targetFallback);

            const caption = `${poder.emoji} ${senderDisp.text} ${poder.verbo} ${targetDisp.text}`;
            const mentions = [senderDisp.jid, targetDisp.jid].filter(Boolean);
            if (media) {
                if (media.ext === '.mp4') {
                    try {
                        await sock.sendMessage(from, { video: media.buffer, mimetype: 'video/mp4', gifPlayback: true, caption, mentions }, { quoted: m });
                        return current;
                    } catch (e) {
                        console.error(`❌ [lancar] envio video falhou, tentando documento:`, e.message);
                        say('video falhou', e.message);
                    }
                }
                if (media.ext === '.gif') {
                    try {
                        await sock.sendMessage(from, { document: media.buffer, mimetype: 'image/gif', fileName: `${poder.dir}.gif`, caption, mentions }, { quoted: m });
                        return current;
                    } catch (e) {
                        console.error(`❌ [lancar] envio documento falhou, tentando imagem:`, e.message);
                        say('documento falhou', e.message);
                    }
                }
                try {
                    await sock.sendMessage(from, { image: media.buffer, caption, mentions }, { quoted: m });
                    return current;
                } catch (e) {
                    console.error(`❌ [lancar] envio imagem falhou, enviando só texto:`, e.message);
                    say('imagem falhou', e.message);
                }
            }
            await sock.sendMessage(from, { text: caption, mentions }, { quoted: m });
            return current;
        } catch (e) {
            console.error(`❌ [lancar] erro:`, e.message);
            await sock.sendMessage(from, { text: `❌ Falha ao executar !lancar.` }, { quoted: m });
            return current;
        }
    }
};
