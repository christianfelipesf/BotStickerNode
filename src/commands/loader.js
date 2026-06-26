const fs = require('fs');
const path = require('path');

const commands = new Map();

/**
 * Carrega comandos de src/commands/ em 2 fases:
 * 1. Scan síncrono rápido (fs.readdirSync) — descobre arquivos
 * 2. require() em background via setImmediate — não bloqueia startup
 * Retorna summary { total, loaded, errors, warnings, aliases }.
 */
function loadCommands(options = {}) {
    const { verbose = false } = options;
    const summary = {
        total: 0,
        loaded: 0,
        errors: 0,
        warnings: 0,
        aliases: 0,
        items: []
    };

    const files = fs.readdirSync(__dirname).filter(file => file.endsWith('.js') && file !== 'loader.js');
    summary.total = files.length;

    // Require em lote via setImmediate para não travar o event loop
    setImmediate(() => {
        for (const file of files) {
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
        if (summary.errors > 0) {
            console.error(`📦 [commands] resumo: ${summary.loaded}/${summary.total} ok • ${summary.errors} erro(s) • ${summary.aliases} aliases`);
        } else {
            console.log(`📦 [commands] ${summary.loaded} comandos, ${summary.aliases} aliases${summary.warnings ? `, ${summary.warnings} aviso(s)` : ''}`);
        }
    });

    return summary;
}

module.exports = {
    loadCommands,
    commands
};
