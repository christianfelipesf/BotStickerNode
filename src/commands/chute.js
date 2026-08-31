const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'chute',
    aliases: ["chutar","kick","chutou"],
    description: 'Dá um chute em um usuário',
    emoji: '🦶',
    captionVerb: 'chutou',
    endpointKey: 'chute'
});
