const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'morder',
    aliases: ["mordida","bite","mordeu"],
    description: 'Morde um usuário',
    emoji: '😼',
    captionVerb: 'mordeu',
    endpointKey: 'morder'
});
