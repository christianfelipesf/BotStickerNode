const { getRecentMessages } = require('../events/message');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

module.exports = {
    name: 'limpar',
    aliases: ['clear', 'purge', 'delete', 'apagar', 'del', 'clearchat'],
    category: 'admin',
    description: 'Apaga as últimas N mensagens do grupo (padrão 10)',
    async execute(sock, m, { from, isGroup, sender, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, getAdmins, isUserAdmin, normalizeJid, readConfig } = utils;

        if (!isGroup) {
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const cfg = readConfig();
        let limit = Number(cfg.clearDefaultLimit) || DEFAULT_LIMIT;
        const parsed = parseInt((fullArgsText || '').trim().split(/\s+/)[0], 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            limit = Math.min(parsed, MAX_LIMIT);
        }

        const meId = normalizeJid(sock.user.id);
        const senderNorm = normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;

        let allowed = isBotOwner;
        if (!allowed) {
            try {
                const adminsRaw = await getAdmins(sock, from);
                allowed = isUserAdmin(sender, adminsRaw);
            } catch (_) {}
        }

        if (!allowed) {
            await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
            return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
        }

        const recent = getRecentMessages(from, limit);
        if (recent.length === 0) {
            await sock.sendMessage(from, { text: `ℹ️ Nenhuma mensagem recente registrada para apagar.` }, { quoted: m });
            return await react(sock, m, 'ℹ️', lastBotResponse, GLOBAL_COOLDOWN);
        }

        await react(sock, m, '🧹', lastBotResponse, GLOBAL_COOLDOWN);

        let deleted = 0;
        let failed = 0;
        let rateLimited = 0;
        for (const item of recent) {
            try {
                const key = {
                    remoteJid: from,
                    id: item.id,
                    participant: item.participant || undefined,
                    fromMe: !!item.fromMe
                };
                await utils.sendMessageSafe(sock, from, { delete: key }, {
                    maxRetries: 2,
                    onRetry: (n, wait) => { rateLimited++; console.warn(`🧹 [limpar] rate-limit tentativa ${n}, aguardando ${wait}ms`); }
                });
                deleted++;
                await new Promise(r => setTimeout(r, 800));
            } catch (e) {
                failed++;
            }
        }

        const summary = failed === 0
            ? `🧹 ${deleted} mensagem(ns) apagada(s).`
            : `🧹 ${deleted} apagada(s), ${failed} falhou(aram) (provavelmente mensagens de outros bots ou antigas demais).`;
        if (rateLimited > 0) {
            console.warn(`🧹 [limpar] ${rateLimited} retentativa(s) por rate-limit.`);
        }
        await utils.sendMessageSafe(sock, from, { text: summary }, { sendOptions: { quoted: m }, maxRetries: 3 });
        return await react(sock, m, '✅', lastBotResponse, GLOBAL_COOLDOWN);
    }
};
