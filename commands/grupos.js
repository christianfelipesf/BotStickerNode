module.exports = {
    name: 'grupos',
    aliases: ['groups', 'listagrupos'],
    category: 'admin',
    description: 'Lista todos os grupos ativos e seus membros mais ativos do dia',
    async execute(sock, m, { from, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, readConfig, getTopMember, getGroupData } = utils;
        
        let currentBotResponse = await react(sock, m, '📊', lastBotResponse, GLOBAL_COOLDOWN);
        
        const db = require('../utils').readDB();
        const activeGroups = db.groups.activeGroups;

        if (activeGroups.length === 0) {
            await sock.sendMessage(from, { text: '❌ Não há grupos ativos no momento.' }, { quoted: m });
            return currentBotResponse;
        }

        let report = `🏰 *GRUPOS ATIVOS*\n\n`;

        for (const jid of activeGroups) {
            try {
                const groupMetadata = await sock.groupMetadata(jid);
                const customData = getGroupData(jid);
                const groupName = customData.botName || groupMetadata.subject;
                const topMember = getTopMember(jid);

                report += `👥 *Grupo:* ${groupName}\n`;
                report += `🆔 *ID:* ${jid.split('@')[0]}\n`;
                report += `🌟 *Membro Ativo:* ${topMember}\n`;
                report += `────────────────\n`;
            } catch (err) {
                // Se não conseguir pegar metadata (bot saiu do grupo), pula ou remove
                report += `⚠️ *Grupo Inacessível:* ${jid.split('@')[0]}\n🌟 *Membro Ativo:* -\n────────────────\n`;
            }
        }

        await sock.sendMessage(from, { text: report }, { quoted: m });
        return currentBotResponse;
    }
};
