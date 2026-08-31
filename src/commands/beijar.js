const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'beijar',
    aliases: ["kiss","beijo","beijos","beijinho","beijao","beijão","kisar","bjo"],
    description: 'Beija um usuário marcado',
    emoji: '💋',
    captionVerb: 'beijou',
    endpointKey: 'beijar',
    selfMessage: '😅 Você não pode beijar a si mesmo! Marque outra pessoa.'
});
