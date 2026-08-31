const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'cuddle',
    aliases: ["aconchegar","cuddling","aninhar"],
    description: 'Aconchega um usuário',
    emoji: '🥺',
    captionVerb: 'aconchegou',
    endpointKey: 'cuddle'
});
