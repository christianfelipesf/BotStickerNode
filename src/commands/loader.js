const fs = require('fs');
const path = require('path');

const commands = new Map();

function loadCommands() {
    const commandFiles = fs.readdirSync(__dirname).filter(file => file.endsWith('.js') && file !== 'loader.js');
    for (const file of commandFiles) {
        try {
            const command = require(`./${file}`);
            if (command && command.name) {
                commands.set(command.name, command);
                console.log(`✅ Comando carregado: ${command.name}`);
            } else {
                console.warn(`⚠️ O comando em './commands/${file}' não exporta uma propriedade 'name'.`);
            }
        } catch (e) {
            console.error(`❌ Erro ao carregar o comando ${file}:`, e);
        }
    }
}

module.exports = {
    loadCommands,
    commands
};
