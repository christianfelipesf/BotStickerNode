const { getGroupData, isMuted, botIsAdmin, isUserAdmin, getAdmins, normalizeJid, setGroupData } = require('../database/utils');

async function enforceMuteAndAntilink(sock, m, from, sender, text) {
    const groupData = getGroupData(from);
    const utilsRef = require('../database/utils');
    const adminsRaw = await getAdmins(sock, from);
    const senderNorm = normalizeJid(sender);
    const senderUser = senderNorm.split('@')[0];
    const isSenderAdmin = adminsRaw.some(p => {
        const candidates = [p.id, p.jid, p.lid].filter(Boolean).map(j => utilsRef.normalizeJid(j));
        return candidates.some(c => c.split('@')[0] === senderUser);
    });
    const isBotAdmin = await botIsAdmin(sock, from);

    if (!isSenderAdmin && isMuted(from, sender)) {
        if (isBotAdmin) {
            try { await sock.sendMessage(from, { delete: m.key }); } catch (delErr) { console.error('❌ Falha ao apagar mensagem de mutado:', delErr.message); }
        }
        return 'muted';
    }

    if (groupData.antilink && !isSenderAdmin && isBotAdmin) {
        const groupLinkRegex = /chat\.whatsapp\.com\/[a-zA-Z0-9]/;
        if (groupLinkRegex.test(text)) {
            await sock.sendMessage(from, { delete: m.key });
            if (!groupData.warnings) groupData.warnings = {};
            groupData.warnings[sender] = (groupData.warnings[sender] || 0) + 2;
            const count = groupData.warnings[sender];
            setGroupData(from, groupData);
            if (count >= 3) {
                await sock.groupParticipantsUpdate(from, [sender], 'remove');
                delete groupData.warnings[sender];
                setGroupData(from, groupData);
                await sock.sendMessage(from, { text: `🚫 @${sender.split('@')[0]} enviou link, atingiu ${count}/3 advertências e foi banido.`, mentions: [sender] });
            } else {
                await sock.sendMessage(from, { text: `⚠️ @${sender.split('@')[0]} enviou link e recebeu 2 advertências. (${count}/3)`, mentions: [sender] });
            }
            return 'antilink';
        }
    }

    return null;
}

module.exports = { enforceMuteAndAntilink };
