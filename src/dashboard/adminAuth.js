require('dotenv').config();
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
    const envSecret = process.env.SESSION_SECRET;
    d = { username, passwordHash: hash(password), sessionSecret: envSecret || newSecret(), previousSessionSecret: null };
    save(d);
    const src = envSecret ? 'via .env' : 'gerada';
    console.log(`\n🔐 ADMIN — Credenciais geradas:\n   Usuário: ${username}\n   Senha:   ${password}\n   ⚠️ Guarde! Aparece só agora.\n   Dica: rode "npm run reset:admin" para trocar.\n   🔑 Sessão: chave ${src}\n`);
    return d;
}

const verify = (u, p) => { const d = load(); return !!(d && d.username === u && verifyHash(d.passwordHash, p)); };
const setCredentials = (u, p) => {
    const cur = load() || {};
    save({ ...cur, username: u, passwordHash: hash(p), previousSessionSecret: cur.sessionSecret || null, sessionSecret: newSecret() });
};

function getSessionKeys() {
    const d = load() || {};
    if (!d.sessionSecret) { d.sessionSecret = process.env.SESSION_SECRET || newSecret(); d.previousSessionSecret = null; save(d); }
    const keys = [d.sessionSecret];
    if (d.previousSessionSecret) keys.push(d.previousSessionSecret);
    return keys;
}

const ROTATION_INTERVAL = 24 * 60 * 60 * 1000;

function rotateSessionSecret() {
    const d = load();
    if (!d) return;
    d.previousSessionSecret = d.sessionSecret || null;
    d.sessionSecret = newSecret();
    save(d);
    console.log(`🔑 [adminAuth] chave de sessão rotacionada (anterior mantida para validação)`);
}

function startSessionRotation(intervalMs = ROTATION_INTERVAL) {
    setInterval(rotateSessionSecret, intervalMs).unref();
}

module.exports = { ensureDefault, verify, setCredentials, getSessionKeys, startSessionRotation };
