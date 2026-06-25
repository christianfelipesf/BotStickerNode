const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ADMIN_FILE = path.join(process.cwd(), 'admin.json');

const DEFAULT_ADMIN = {
    username: 'admin',
    passwordHash: null,
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    createdAt: null,
    updatedAt: null
};

function load() {
    try {
        if (!fs.existsSync(ADMIN_FILE)) return { ...DEFAULT_ADMIN };
        const raw = fs.readFileSync(ADMIN_FILE, 'utf8');
        const data = JSON.parse(raw);
        return { ...DEFAULT_ADMIN, ...data };
    } catch (_) {
        return { ...DEFAULT_ADMIN };
    }
}

function save(data) {
    try {
        const out = { ...data, updatedAt: new Date().toISOString() };
        fs.writeFileSync(ADMIN_FILE, JSON.stringify(out, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[adminAuth] falha ao salvar:', e.message);
        return false;
    }
}

function generateStrongPassword(length = 12) {
    const charset = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*?+';
    const bytes = crypto.randomBytes(length * 2);
    let pwd = '';
    for (let i = 0; i < bytes.length && pwd.length < length; i++) {
        pwd += charset[bytes[i] % charset.length];
    }
    return pwd;
}

function ensureDefaultCredentials() {
    const data = load();
    if (!data.passwordHash) {
        data.username = data.username || 'admin';
        const generatedPassword = generateStrongPassword(12);
        data.passwordHash = bcrypt.hashSync(generatedPassword, 10);
        data.initialPasswordPlain = generatedPassword;
        data.createdAt = data.createdAt || new Date().toISOString();
        save(data);
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('🛡️  ADMIN PANEL — CREDENCIAIS GERADAS');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`   Usuário: ${data.username}`);
        console.log(`   Senha:   ${generatedPassword}`);
        console.log('   ⚠️  Guarde esta senha! Ela aparece APENAS agora.');
        console.log('   💡 Troque pelo painel /admin após o primeiro login.');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('');
    }
    return data;
}

function verifyCredentials(username, password) {
    const data = load();
    if (!data.passwordHash) return false;
    if (data.username !== username) return false;
    try { return bcrypt.compareSync(password, data.passwordHash); }
    catch (_) { return false; }
}

function setCredentials(username, password) {
    if (!username || typeof username !== 'string' || username.length < 3 || username.length > 32) {
        return { ok: false, error: 'Usuário deve ter entre 3 e 32 caracteres' };
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
        return { ok: false, error: 'Senha deve ter no mínimo 4 caracteres' };
    }
    const data = load();
    data.username = username;
    data.passwordHash = bcrypt.hashSync(password, 10);
    if (!data.createdAt) data.createdAt = new Date().toISOString();
    save(data);
    return { ok: true };
}

function getInfo() {
    const data = load();
    return {
        username: data.username,
        hasPassword: !!data.passwordHash,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
    };
}

function getSessionSecret() {
    const data = load();
    if (!data.sessionSecret) {
        data.sessionSecret = crypto.randomBytes(32).toString('hex');
        save(data);
    }
    return data.sessionSecret;
}

function consumeInitialPassword() {
    const data = load();
    const pwd = data.initialPasswordPlain;
    if (!pwd) return null;
    delete data.initialPasswordPlain;
    save(data);
    return pwd;
}

module.exports = {
    ensureDefaultCredentials,
    verifyCredentials,
    setCredentials,
    getInfo,
    getSessionSecret,
    consumeInitialPassword,
    generateStrongPassword,
    ADMIN_FILE
};
