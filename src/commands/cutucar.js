const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'cutucar',
    aliases: ["poke","cutucada","cutucou"],
    description: 'Cutuca um usuário',
    emoji: '👉',
    captionVerb: 'cutucou',
    endpointKey: 'cutucar'
});
