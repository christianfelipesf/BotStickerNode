const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'soco',
    aliases: ["socar","punch","murro"],
    description: 'Dá um soco em um usuário',
    emoji: '👊',
    captionVerb: 'deu um soco em',
    endpointKey: 'soco'
});
