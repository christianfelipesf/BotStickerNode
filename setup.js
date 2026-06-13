const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const YT_DLP_URLS = {
    win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
    darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
};

const isTermux = () => {
    return process.env.PREFIX && process.env.PREFIX.includes('com.termux') || 
           fs.existsSync('/data/data/com.termux');
};

async function checkNodeModules() {
    if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
        console.log('📦 [SETUP] node_modules não encontrado. Instalando dependências do npm...');
        try {
            // Em Termux, o npm install pode precisar de flags extras se houver compilação de nativos
            const cmd = isTermux() ? 'npm install' : 'npm install';
            execSync(cmd, { stdio: 'inherit' });
            console.log('✅ [SETUP] Dependências do npm instaladas com sucesso.');
        } catch (error) {
            console.error('❌ [SETUP] Erro ao instalar dependências do npm:', error.message);
            if (isTermux()) {
                console.log('\n💡 [TERMUX] Tente rodar: pkg install nodejs git ffmpeg python python-pip make clang pkg-config libvips');
            }
            process.exit(1);
        }
    } else {
        console.log('✅ [SETUP] node_modules encontrado.');
    }
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location, dest).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Falha ao baixar arquivo: ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

async function checkYtDlp() {
    const platform = os.platform();
    const ext = platform === 'win32' ? '.exe' : '';
    const localPath = path.join(__dirname, `yt-dlp${ext}`);
    
    // Check if it's in the PATH first
    try {
        const cmd = platform === 'win32' ? 'where yt-dlp' : 'which yt-dlp';
        execSync(cmd, { stdio: 'ignore' });
        console.log('✅ [SETUP] yt-dlp encontrado no sistema.');
        return;
    } catch (e) {
        // Not in path, check local
        if (fs.existsSync(localPath)) {
            console.log('✅ [SETUP] yt-dlp encontrado localmente.');
            return;
        }
    }

    if (isTermux()) {
        console.log('⚠️ [SETUP] yt-dlp não encontrado. No Termux, instale via: pip install yt-dlp');
        return;
    }

    console.log(`📥 [SETUP] yt-dlp não encontrado. Baixando para a plataforma: ${platform}...`);
    const url = YT_DLP_URLS[platform] || YT_DLP_URLS['linux'];
    
    try {
        await downloadFile(url, localPath);
        if (platform !== 'win32') {
            fs.chmodSync(localPath, '755');
        }
        console.log('✅ [SETUP] yt-dlp baixado com sucesso.');
    } catch (error) {
        console.error('❌ [SETUP] Erro ao baixar yt-dlp:', error.message);
        console.log('⚠️ [SETUP] O bot pode falhar ao usar o comando !play.');
    }
}

async function checkFfmpeg() {
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        console.log('✅ [SETUP] FFmpeg encontrado no sistema.');
    } catch (e) {
        if (isTermux()) {
            console.log('⚠️ [SETUP] FFmpeg não encontrado. Instale no Termux com: pkg install ffmpeg');
        } else {
            console.log('ℹ️ [SETUP] FFmpeg não encontrado no sistema. O bot usará a versão estática do npm.');
        }
    }
}

async function main() {
    console.log('🚀 [SETUP] Iniciando verificação de dependências...');
    if (isTermux()) console.log('📱 [SETUP] Ambiente Termux detectado.');

    await checkNodeModules();
    await checkFfmpeg();
    await checkYtDlp();
    
    console.log('🏁 [SETUP] Verificação concluída!\n');
}

if (require.main === module) {
    main();
}

module.exports = { main };
