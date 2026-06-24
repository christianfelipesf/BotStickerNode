// Simula o boot do index.js sem conectar ao WhatsApp
// (substitui startBot para nao tentar conexao real)
const Module = require('module');
const origCompile = Module.prototype._compile;
let skipped = 0;
Module.prototype._compile = function(content, filename) {
    if (filename.endsWith('index.js') && content.includes('startBot();')) {
        // Substitui startBot() por nada
        content = content.replace(/startBot\(\);[\s]*$/, '// skipped');
        skipped++;
    }
    return origCompile.call(this, content, filename);
};

// Patch o require para que a funcao `startBot` do nosso escopo seja ignorada
// Tambem bloqueia socket.io/socket real
const realMake = require('@whiskeysockets/baileys').makeWASocket;
require('@whiskeysockets/baileys').makeWASocket = () => {
    return {
        ev: { on: () => {} },
        user: { id: 'test:0@s.whatsapp.net' },
        updateMediaMessage: () => {},
        sendMessage: async () => ({ key: { id: 'x' } }),
        groupMetadata: async () => ({ subject: 'test' }),
        profilePictureUrl: async () => null,
        groupFetchAllParticipating: async () => ({}),
        end: () => {}
    };
};

// Override startBot para nao rodar de verdade
const path = require('path');
const realIndexPath = path.resolve('./index.js');
delete require.cache[realIndexPath];

// Patch simples: importar index.js quebra o event loop com startBot
// Entao so carrego os modulos manualmente para ver o boot output
console.log('--- BOOT SIMULADO (modulos carregados, startBot pulado) ---\n');

// Cache refs e executa o setup manualmente
require('./src/services/logger').initLogger();
require('./src/services/trace').patch();
require('./src/services/terminalLog').init();

const utils = require('./src/database/utils');
const config = utils.readConfig();
const { loadCommands } = require('./src/commands/loader');
const setupAI = require('./src/services/ai').setupAI;
const dashboard = require('./src/dashboard/dashboard');

try { dashboard.init(config); } catch (_) {}
try { setupAI(config); } catch (_) {}
const _cmdSummary = loadCommands({ verbose: false });

const _ffmpeg = 'ffmpeg.exe (simulado)';
const _utils = require('./src/database/utils');
const _dashOk = !!dashboard && typeof dashboard.init === 'function';
const _aiOk = !!_utils.getModel && !!_utils.getModel();
const _sockDir = require('fs').existsSync('session') ? 'sim' : 'nao';
const _nodeVer = process.version;
const _os = `${process.platform} ${process.arch}`;
const _restartNumber = utils.incrementRestart();

console.log('');
console.log('='.repeat(60));
console.log('??  ' + config.botName.toUpperCase() + ' • v' + _utils.getVersion() + ' • Reinício #' + _restartNumber);
console.log('='.repeat(60));
console.log('  ?? comandos     ' + _cmdSummary.loaded + '/' + _cmdSummary.total + ' carregados • ' + _cmdSummary.aliases + ' aliases' + (_cmdSummary.errors ? ' • ' + _cmdSummary.errors + ' ERRO(s)' : ''));
console.log('  ?? database     ' + _utils.countDashboardLogs() + ' logs • bot.db OK');
console.log('  ?? dashboard    ' + (_dashOk ? '? módulo ok' : '? falhou') + ' na porta ' + config.dashboardPort);
console.log('  ?? IA Gemini    ' + (_aiOk ? '? ativa (' + (config.geminiModel || 'default') + ')' : '? sem API key'));
console.log('  ?? news         ' + (config.newsEnabled !== false ? '? ativo' : '? desativado'));
console.log('  ?? ffmpeg       ' + _ffmpeg);
console.log('  ?? sessão       ' + (_sockDir === 'sim' ? '? salva' : '? QR necessário'));
console.log('  ??  plataforma   ' + _os + ' • Node ' + _nodeVer);
console.log('='.repeat(60));
console.log('\n--- fim do boot ---\n');
