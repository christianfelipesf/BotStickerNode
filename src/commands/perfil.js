module.exports = {
    name: 'perfil',
    aliases: ['pp', 'profile'],
    category: 'geral',
    description: 'Exibe a foto de perfil de um usuário',
    async execute(sock, m, { from, sender, utils, lastBotResponse, GLOBAL_COOLDOWN }) {
        const { react } = utils;
        let currentBotResponse = await react(sock, m, '👤', lastBotResponse, GLOBAL_COOLDOWN);
        
        try {
            const qInfo = m.message.extendedTextMessage?.contextInfo;
            const target = qInfo?.mentionedJid?.[0] || qInfo?.participant || sender;
            const ppUrl = await sock.profilePictureUrl(target, 'image').catch(() => 'https://web.whatsapp.com/img/default-user-icon.jpg');
            
            await sock.sendMessage(from, { 
                image: { url: ppUrl }, 
                caption: `👤 *Perfil* @${target.split('@')[0]}`, 
                mentions: [target] 
            }, { quoted: m });
        } catch (e) { 
            currentBotResponse = await react(sock, m, '❌', currentBotResponse, GLOBAL_COOLDOWN); 
        }
        
        return currentBotResponse;
    }
};
