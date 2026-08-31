const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'matar',
    aliases: ["kill","matou"],
    description: 'Mata um usuário (brincadeira)',
    emoji: '💀',
    captionVerb: 'matou',
    endpointKey: 'matar'
});
