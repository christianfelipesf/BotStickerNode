const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'lamber',
    aliases: ["lick","lambida","lambidinha"],
    description: 'Lambe um usuário',
    emoji: '👅',
    captionVerb: 'lambeu',
    endpointKey: 'lamber'
});
