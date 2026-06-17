module.exports = {
    name: 'grupos',
    aliases: ['groups', 'listagrupos'],
    category: 'admin',
    description: 'Lista todos os grupos ativos e seus membros mais ativos do dia',
    async execute(sock, m, { from, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, readConfig, getTopMember, getGroupData } = utils;
        
        let currentBotResponse = await react(sock, m, '📊', lastBotResponse, GLOBAL_COOLDOWN);
        
        const db = require('../utils').readDB();
        const activeGroups = db.groups.activeGroups || [];

        if (activeGroups.length === 0) {
            await sock.sendMessage(from, { text: '❌ Não há grupos ativos no momento.' }, { quoted: m });
            return currentBotResponse;
        }

        let report = `🏰 *GRUPOS ATIVOS*\n\n`;
        let foundAny = false;

        for (const jid of activeGroups) {
            // Filtrar apenas JIDs de grupos válidos
            if (!jid.endsWith('@g.us')) continue;
            
            try {
                const groupMetadata = await sock.groupMetadata(jid);
                if (!groupMetadata) continue;

                const customData = getGroupData(jid);
                const groupName = customData.botName || groupMetadata.subject;
                const topMember = getTopMember(jid);

                report += `👥 *Grupo:* ${groupName}\n`;
                report += `🆔 *ID:* ${jid.split('@')[0]}\n`;
                report += `🌟 *Membro Ativo:* ${topMember}\n`;
                report += `────────────────\n`;
                foundAny = true;
            } catch (err) {
                // Se o bot não estiver mais no grupo ou der erro de permissão, ignoramos na lista
                console.log(`⚠️ Ignorando grupo inacessível no !grupos: ${jid}`);
            }
        }

        if (!foundAny) {
            return sock.sendMessage(from, { text: '❌ Nenhum grupo ativo encontrado na base de dados.' }, { quoted: m });
        }

        await sock.sendMessage(from, { text: report }, { quoted: m });
        return currentBotResponse;
    }
};
