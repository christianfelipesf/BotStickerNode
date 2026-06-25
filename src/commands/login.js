const subSessions = require('../services/subSessions');

function normalizePhone(input) {
    if (!input) return null;
    const raw = String(input).trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    return digits;
}

module.exports = {
    name: 'login',
    aliases: ['entrar', 'conectar'],
    category: 'admin',
    description: 'Conecta uma sub-sessão Baileys (QR Code ou código de pareamento)',
    async execute(sock, m, { from, sender, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
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

        const phoneArg = normalizePhone(fullArgsText);
        const usePairing = !!phoneArg;

        let currentBotResponse = await react(sock, m, '🔐', lastBotResponse, GLOBAL_COOLDOWN);

        if (usePairing) {
            await sock.sendMessage(from, {
                text: `🔐 *Sub-sessão iniciando…*\n\n📞 *Número:* \`${phoneArg}\`\n📲 *Modo:* código de pareamento\n\nVou gerar um *código de 8 dígitos* para você digitar no WhatsApp.\n\n⏱️ Você tem até 5 minutos para parear.`
            }, { quoted: m });
        } else {
            await sock.sendMessage(from, {
                text: '🔐 *Sub-sessão iniciando…*\n\nVou enviar o QR Code em até *3 tentativas*. Escaneie no WhatsApp → Aparelhos conectados.\n\n💡 _Dica:_ use `!login 5511999999999` para parear com código de 8 dígitos em vez de QR.\n\n⏱️ Você tem ~1 min por QR.'
            }, { quoted: m });
        }

        try {
            await subSessions.startLogin(ownerJid, {
                phoneNumber: usePairing ? phoneArg : null,
                onQr: async (jid, { buffer, attempt, max }) => {
                    if (usePairing) return;
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
                onPairingCode: async (jid, { code, phoneNumber }) => {
                    try {
                        const formatted = `${code.slice(0, 4)}-${code.slice(4)}`;
                        await sock.sendMessage(from, {
                            text: `🔢 *Código de pareamento*\n\n📞 *Número:* \`${phoneNumber}\`\n🔐 *Código:* \`${formatted}\`\n\n📱 *Como usar:*\n1. Abra o WhatsApp no celular\n2. ⋮ (três pontos) → *Aparelhos conectados*\n3. Toque em *Conectar um aparelho*\n4. Toque em *Conectar com número de telefone*\n5. Digite o código acima: *${formatted}*\n\n⏱️ Código válido por ~5 minutos.`
                        }, { quoted: m });
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
