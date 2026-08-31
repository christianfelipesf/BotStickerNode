const { createInteractionCommand } = require('../services/interactionFactory');
module.exports = createInteractionCommand({
    name: 'abraco',
    aliases: ["abracar","abraçar","hug","abracinho"],
    description: 'Abraça um usuário marcado',
    emoji: '🤗',
    captionVerb: 'abraçou',
    endpointKey: 'abraco',
    selfMessage: '🥺 Você se abraçou! Mas que tal abraçar outra pessoa?'
});
