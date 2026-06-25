const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'admin.json');

const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } };
const save = d => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(d, null, 2)); try { fs.chmodSync(FILE, 0o600); } catch {} return true; } catch (e) { console.error('[adminAuth]', e.message); return false; } };
const genPwd = n => crypto.randomBytes(n * 2).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, n);
const newSecret = () => crypto.randomBytes(32).toString('hex');
const hash = pwd => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.createHash('sha256').update(salt + pwd).digest('hex'); };
const verifyHash = (stored, pwd) => {
    if (!stored) return false;
    const i = stored.indexOf(':');
    if (i < 0) return false;
    const salt = stored.slice(0, i);
    const want = stored.slice(i + 1);
    const got = crypto.createHash('sha256').update(salt + pwd).digest('hex');
    return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'));
};

function ensureDefault() {
    let d = load();
    if (d?.username && d?.passwordHash) return d;
    const username = 'admin';
    const password = genPwd(10);
    d = { username, passwordHash: hash(password), sessionSecret: newSecret() };
    save(d);
    console.log(`\n🔐 ADMIN — Credenciais geradas:\n   Usuário: ${username}\n   Senha:   ${password}\n   ⚠️ Guarde! Aparece só agora.\n   Dica: rode "npm run reset:admin" para trocar.\n`);
    return d;
}

const verify = (u, p) => { const d = load(); return !!(d && d.username === u && verifyHash(d.passwordHash, p)); };
const setCredentials = (u, p) => save({ ...(load() || {}), username: u, passwordHash: hash(p), sessionSecret: newSecret() });

function getSessionSecret() {
    const d = load() || {};
    if (!d.sessionSecret) { d.sessionSecret = newSecret(); save(d); }
    return d.sessionSecret;
}

module.exports = { ensureDefault, verify, setCredentials, getSessionSecret };
