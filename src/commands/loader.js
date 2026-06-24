const fs = require('fs');
const path = require('path');

const commands = new Map();

/**
 * Carrega todos os comandos de src/commands/.
 * Silencia o log por comando para manter o boot limpo.
 * Retorna um summary { total, loaded, errors, warnings, aliases }.
 */
function loadCommands(options = {}) {
    const { verbose = false } = options;
    const summary = {
        total: 0,
        loaded: 0,
        errors: 0,
        warnings: 0,
        aliases: 0,
        items: [] // { file, status, name, error? }
    };

    const commandFiles = fs.readdirSync(__dirname)
        .filter(file => file.endsWith('.js') && file !== 'loader.js');

    for (const file of commandFiles) {
        summary.total++;
        try {
            const command = require(`./${file}`);
            if (command && command.name) {
                commands.set(command.name, command);
                summary.loaded++;
                if (Array.isArray(command.aliases)) summary.aliases += command.aliases.length;
                summary.items.push({ file, status: 'ok', name: command.name });
                if (verbose) console.log(`✅ Comando carregado: ${command.name}`);
            } else {
                summary.warnings++;
                summary.items.push({ file, status: 'no-name', error: 'não exporta propriedade name' });
                console.warn(`⚠️ [commands/${file}] não exporta propriedade 'name' — ignorado`);
            }
        } catch (e) {
            summary.errors++;
            summary.items.push({ file, status: 'error', error: e.message });
            console.error(`❌ [commands/${file}] falhou: ${e.message}`);
        }
    }

    // Log de summary em uma linha só (útil para logs em Docker / journalctl)
    if (summary.errors > 0) {
        console.error(`📦 [commands] resumo: ${summary.loaded}/${summary.total} ok • ${summary.errors} erro(s) • ${summary.aliases} aliases`);
    } else {
        console.log(`📦 [commands] ${summary.loaded} comandos, ${summary.aliases} aliases${summary.warnings ? `, ${summary.warnings} aviso(s)` : ''}`);
    }

    return summary;
}

module.exports = {
    loadCommands,
    commands
};
