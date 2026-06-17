const download = require('./download');

module.exports = {
    name: 'downloadhd',
    aliases: ['dhd', 'dlhd', 'downloadh'],
    category: 'mídia',
    description: 'Baixa mídia em alta definição (HD)',
    async execute(sock, m, context) {
        return await download.execute(sock, m, { ...context, commandName: 'downloadhd' });
    }
};
