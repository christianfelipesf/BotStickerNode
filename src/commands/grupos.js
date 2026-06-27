module.exports = {
    name: 'grupos',
    aliases: ['groups', 'listagrupos'],
    category: 'admin',
    description: 'Lista todos os grupos ativos e parcialmente ativos com seus membros mais ativos do dia',
    async execute(sock, m, { from, sender, config, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react, readConfig, getTopMember, getGroupData, listActiveGroups, listPartialGroups } = utils;

        const meId = utils.normalizeJid(sock.user.id);
        const senderNorm = utils.normalizeJid(sender);
        const isBotOwner = m.key.fromMe === true || sender === meId || senderNorm === meId;
        if (!isBotOwner) {
            return await sock.sendMessage(from, { text: '❌ Apenas o dono do bot pode usar este comando.' }, { quoted: m });
        }

        let currentBotResponse = await react(sock, m, '📊', lastBotResponse, GLOBAL_COOLDOWN);

        const activeGroups = listActiveGroups();
        const partialGroups = listPartialGroups();

        if (activeGroups.length === 0 && partialGroups.length === 0) {
            await sock.sendMessage(from, { text: '❌ Não há grupos ativos ou parcialmente ativos no momento.' }, { quoted: m });
            return currentBotResponse;
        }

        let report = `🏰 *GRUPOS DO BOT*\n\n`;

        async function buildSection(label, jids, icon) {
            let section = '';
            for (const jid of jids) {
                if (!jid.endsWith('@g.us')) continue;
                try {
                    const groupMetadata = await sock.groupMetadata(jid);
                    if (!groupMetadata) continue;
                    const customData = getGroupData(jid);
                    const groupName = customData.botName || groupMetadata.subject;
                    const topMember = getTopMember(jid);
                    section += `${icon} *${groupName}*\n🆔 ${jid.split('@')[0]}\n🌟 ${topMember}\n────────────────\n`;
                } catch (err) {
                    console.log(`⚠️ Ignorando grupo inacessível no !grupos: ${jid}`);
                }
            }
            if (section) {
                report += `📌 *${label}* (${jids.length})\n${section}`;
            }
            return section;
        }

        const sectionActive = await buildSection('ATIVOS', activeGroups, '✅');
        const sectionPartial = await buildSection('PARCIALMENTE ATIVOS', partialGroups, '⏸️');

        if (!sectionActive && !sectionPartial) {
            return sock.sendMessage(from, { text: '❌ Nenhum grupo encontrado na base de dados.' }, { quoted: m });
        }

        await sock.sendMessage(from, { text: report }, { quoted: m });
        return currentBotResponse;
    }
};
