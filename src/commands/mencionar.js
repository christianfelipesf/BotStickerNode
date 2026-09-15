module.exports = {
    name: 'mencionar',
    aliases: ['todos', 'tagall', 'tag', 'mencionarall'],
    category: 'admin',
    description: 'Marca todos os membros do grupo',
    async execute(sock, m, { from, isGroup, sender, fullArgsText, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, groupMetadataCached } = utils;
        if (!isGroup) return await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);

        // Cache (120s) em vez de fetch direto: tagall em sequência não
        // estoura rate-limit; fallback preserva comportamento antigo.
        let meta;
        try { meta = await groupMetadataCached(sock, from); } catch (_) { meta = null; }
        if (!meta || !Array.isArray(meta.participants)) meta = await sock.groupMetadata(from);
        const adminsRaw = meta.participants
            .filter(p => p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin || p.isSuperAdmin)
            .map(p => ({ id: p.id, jid: p.jid, lid: p.lid, name: p.name }));
        const isSenderAdmin = utils.isUserAdmin(sender, adminsRaw);

        if (!isSenderAdmin && !m.key.fromMe) {
            await react(sock, m, '❌', lastBotResponse, GLOBAL_COOLDOWN);
            return await sock.sendMessage(from, { text: '❌ Apenas administradores podem usar este comando.' }, { quoted: m });
        }
        
        let currentBotResponse = await react(sock, m, '📢', lastBotResponse, GLOBAL_COOLDOWN);
        // Prefere phoneNumber quando o id é @lid: menção com LID puro não
        // notifica em alguns clientes; o número PN sempre notifica.
        const mentions = meta.participants.map(p => {
            const id = p.id || '';
            if (String(id).endsWith('@lid') && p.phoneNumber) return p.phoneNumber;
            return id;
        }).filter(Boolean);
        await sock.sendMessage(from, {
            text: fullArgsText || '📢 Atenção!',
            mentions
        }, { quoted: m });
        
        return currentBotResponse;
    }
};
