const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'cafune',
    aliases: ["cafune","carinho","pat","fazercafune"],
    description: 'Faz cafuné em um usuário',
    emoji: '🥰',
    captionVerb: 'fez cafuné em',
    endpointKey: 'cafune'
});
