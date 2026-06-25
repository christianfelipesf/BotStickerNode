const subSessions = require('../services/subSessions');

module.exports = {
    name: 'login',
    aliases: ['entrar', 'conectar'],
    category: 'admin',
    description: 'Conecta uma sub-sessão Baileys (gera QR Code no WhatsApp)',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        const ownerJid = sender;

        if (subSessions.getSession(ownerJid)) {
            await sock.sendMessage(from, {
                text: '⚠️ Você já tem uma sub-sessão ativa.\nUse !logoff ou !sair para encerrar.'
            }, { quoted: m });
            return await react(sock, m, '⚠️', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(ownerJid);
        const isBotOwner = m.key.fromMe === true || ownerJid === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '🔐', lastBotResponse, GLOBAL_COOLDOWN);

        await sock.sendMessage(from, {
            text: '🔐 *Sub-sessão iniciando…*\n\nVou enviar o QR Code em até *3 tentativas*. Escaneie no WhatsApp → Aparelhos conectados.\n\n⏱️ Você tem ~1 min por QR.'
        }, { quoted: m });

        try {
            await subSessions.startLogin(ownerJid, {
                onQr: async (jid, { buffer, attempt, max }) => {
                    try {
                        if (buffer) {
                            await sock.sendMessage(from, {
                                image: buffer,
                                caption: `📱 *QR ${attempt}/${max}*\nAbra WhatsApp → ⋮ → *Aparelhos conectados* → *Conectar um aparelho* e escaneie esta imagem.`
                            }, { quoted: m });
                        } else {
                            await sock.sendMessage(from, {
                                text: `📱 *QR ${attempt}/${max}*\n_\n(string abaixo é o QR — normalmente envio como imagem, mas falhou agora. Tente escanear a partir do terminal do bot se necessário.)_`
                            }, { quoted: m });
                        }
                    } catch (_) {}
                },
                onConnected: async (jid, { phoneNumber }) => {
                    try {
                        await sock.sendMessage(from, {
                            text: `✅ *Sub-sessão CONECTADA!*\n📞 Número: \`${phoneNumber || '?'}\`\n\nSua sessão pessoal está pronta. Use *!menu* lá para ver os comandos.\nPara encerrar: *!logoff* ou *!sair*.`
                        }, { quoted: m });
                    } catch (_) {}
                },
                onClosed: async (jid, reason) => {
                    try {
                        if (reason === 'qr-exhausted') {
                            await sock.sendMessage(from, {
                                text: '❌ *Sub-sessão cancelada.*\nVocê não escaneou o QR em 3 tentativas. Use !login para tentar novamente.'
                            }, { quoted: m });
                        } else if (reason === 'logged-out') {
                            await sock.sendMessage(from, {
                                text: '🚪 *Sub-sessão desconectada pelo WhatsApp.*\nUse !login para reconectar.'
                            }, { quoted: m });
                        }
                    } catch (_) {}
                }
            });
            currentBotResponse = await react(sock, m, '✅', currentBotResponse, GLOBAL_COOLDOWN);
        } catch (e) {
            await sock.sendMessage(from, { text: `❌ Falha ao iniciar sub-sessão: ${e.message || e}` }, { quoted: m });
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN);
        }

        return currentBotResponse;
    }
};
