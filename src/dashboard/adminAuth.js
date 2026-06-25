const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ADMIN_FILE = path.join(process.cwd(), 'admin.json');

function load() {
    try { return JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')); } catch (_) { return null; }
}

function save(data) {
    try { fs.writeFileSync(ADMIN_FILE, JSON.stringify(data, null, 2)); return true; }
    catch (e) { console.error('[adminAuth]', e.message); return false; }
}

function genPwd(len = 10) {
    return crypto.randomBytes(len * 2).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, len);
}

function ensureDefault() {
    let d = load();
    if (d && d.username && d.passwordHash) return d;

    const username = 'admin';
    const password = genPwd(10);
    d = {
        username,
        passwordHash: bcrypt.hashSync(password, 10),
        sessionSecret: crypto.randomBytes(32).toString('hex')
    };
    save(d);
    console.log(`\n🔐 ADMIN — Credenciais geradas:\n   Usuário: ${username}\n   Senha:   ${password}\n   ⚠️ Guarde! Aparece só agora.\n`);
    return d;
}

function verify(u, p) {
    const d = load();
    if (!d || d.username !== u) return false;
    try { return bcrypt.compareSync(p, d.passwordHash); } catch (_) { return false; }
}

function setCredentials(u, p) {
    const d = load() || {};
    d.username = u;
    d.passwordHash = bcrypt.hashSync(p, 10);
    d.sessionSecret = crypto.randomBytes(32).toString('hex');
    return save(d);
}

function getSessionSecret() {
    const d = load() || {};
    if (!d.sessionSecret) { d.sessionSecret = crypto.randomBytes(32).toString('hex'); save(d); }
    return d.sessionSecret;
}

module.exports = { ensureDefault, verify, setCredentials, getSessionSecret };
