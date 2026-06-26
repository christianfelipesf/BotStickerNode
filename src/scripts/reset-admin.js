#!/usr/bin/env node
// Reset das credenciais do admin (dashboard).
// USO NA VPS:  npm run reset:admin
//   sem args     → usa "admin" e gera senha aleatória (mostrada uma vez)
//   com 2 args   → define usuário e senha fornecidos
// Funciona com o bot parado OU rodando (escreve direto no data/admin.json).
//
// Formato do hash: SHA-256(salt + senha), armazenado como "salt:hashHex".
// O adminAuth.js do bot é compatível com esse formato automaticamente.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(process.cwd(), 'data', 'admin.json');

const genPwd = n => crypto.randomBytes(n * 2).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, n);
const hash = pwd => {
    const salt = crypto.randomBytes(16).toString('hex');
    const h = crypto.createHash('sha256').update(salt + pwd).digest('hex');
    return salt + ':' + h;
};
const ask = q => new Promise(r => { process.stdout.write(q); process.stdin.once('data', d => r(d.toString().trim())); });

async function main() {
    let username = process.argv[2];
    let password = process.argv[3];

    if (!username) {
        if (process.stdin.isTTY) username = (await ask('Novo usuário [admin]: ')) || 'admin';
        else username = 'admin';
    }
    if (!password) {
        if (process.stdin.isTTY) password = await ask('Nova senha (vazio = gerar aleatória): ');
        if (!password) password = genPwd(12);
    }
    if (password.length < 4) { console.error('❌ Senha precisa ter >= 4 caracteres'); process.exit(1); }

    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const data = {
        username,
        passwordHash: hash(password),
        sessionSecret: crypto.randomBytes(32).toString('hex'),
        previousSessionSecret: null
    };
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
    try { fs.chmodSync(FILE, 0o600); } catch (_) {}

    console.log(`\n✅ Credenciais resetadas em ${FILE}`);
    console.log(`   Usuário: ${username}`);
    console.log(`   Senha:   ${password}`);
    console.log('   ⚠️  Guarde agora — não é possível recuperar depois.\n');
    console.log('   Sessões antigas foram invalidadas (sessionSecret novo).');
    console.log('   Se o bot estiver rodando, reinicie: pm2 restart BotStickerNode\n');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
