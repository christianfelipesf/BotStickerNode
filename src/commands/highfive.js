const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'highfive',
    aliases: ["tocaaqui","tocar","highfivee"],
    description: 'Dá um high five',
    emoji: '🙏',
    captionVerb: 'deu um high five em',
    endpointKey: 'highfive'
});
