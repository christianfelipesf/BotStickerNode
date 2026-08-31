const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'tapa',
    aliases: ["slap","tapar"],
    description: 'Dá um tapa em um usuário',
    emoji: '👋',
    captionVerb: 'deu um tapa em',
    endpointKey: 'tapa'
});
