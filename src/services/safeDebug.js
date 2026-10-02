// safeDebug.js — barreira entre debug interno e usuário final.
//
// REGRA: chave API, cookie, token, senha e caminhos absolutos NUNCA vão
// para o chat (WhatsApp). Vão para o terminal (console) e para o Telegram
// do dono via sendAlert. O usuário recebe versão mascarada/genérica.
//
// Uso:
//   const { isSensitiveKey, maskSecret, sanitizeUserText, reportSensitive } = require('../services/safeDebug');
//   // leitura de config sensível:
//   await sock.sendMessage(from, { text: `📝 *${p}* atual: ${maskSecret(v)}` }, ...);
//   reportSensitive({ title: 'Leitura de chave', detail: `${p} = ${v}`, key: `set-read:${p}` });

const SENSITIVE_KEY_RE = /api[_-]?key|token|secret|cookie|passw|passwd|senha|auth[_-]?key|private[_-]?key/i;

function isSensitiveKey(key) {
    return SENSITIVE_KEY_RE.test(String(key || ''));
}

// Valor mascarado p/ exibir no chat. Nunca revela o conteúdo.
function maskSecret(v) {
    if (v == null || v === '') return '_(vazio)_';
    if (Array.isArray(v)) return `_(lista com ${v.length} item(ns) — oculto)_`;
    const len = String(v).length;
    return `•••••••• (${len} chars — oculto, detalhe no Telegram/terminal)`;
}

function _cwdVariants() {
    try {
        const cwd = String(process.cwd() || '');
        if (!cwd) return [];
        const out = [cwd];
        // mesma pasta com barras invertidas/normais
        out.push(cwd.replace(/\//g, '\\'));
        out.push(cwd.replace(/\\/g, '/'));
        return [...new Set(out.filter(Boolean))];
    } catch (_) { return []; }
}

// Remove do texto tudo que não pode ir ao usuário final:
// - pasta do projeto (absoluta) -> "."
// - outros caminhos absolutos (C:\..., /home/..., /tmp/...) -> "[dir]"
// - pares chave=valor de segredos -> chave=••••••••
function sanitizeUserText(text) {
    let s = String(text == null ? '' : text);
    if (!s) return s;
    for (const cwd of _cwdVariants()) {
        if (cwd && s.includes(cwd)) s = s.split(cwd).join('.');
    }
    // Windows absolutos restantes: C:\pasta\..., D:/...
    s = s.replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '[dir]');
    // Unix absolutos típicos de infra
    s = s.replace(/(^|[\s"'`(\[])\/(?:home|root|tmp|var|etc|opt|srv|mnt|data|app|usr)[^\s"'`]*/g, '$1[dir]');
    // chave=valor sensível (ex.: cobaltApiKey=xxxx, cookie: yyy)
    s = s.replace(/((?:api[_-]?key|token|secret|cookie|passw|passwd|senha)[-_a-z0-9]*\s*[:=]\s*)([^\s,;]+)/gi, '$1••••••••');
    return s;
}

// Detalhe completo -> terminal + Telegram do dono (fire-and-forget).
// Nunca chame com o texto que vai ao usuário: aqui vai o REAL.
function reportSensitive({ title, detail, key, cooldownMs }) {
    const label = String(title || 'Detalhe interno');
    try {
        console.error(`🔒 [sensível] ${label}:`, detail);
    } catch (_) {}
    try {
        const { sendAlert } = require('./telegramAlerts');
        const text = `🔒 *${label}*\n\n${String(detail == null ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail))).slice(0, 3000)}`;
        Promise.resolve()
            .then(() => sendAlert(text, { key: String(key || 'sensivel'), parseMode: null, cooldownMs: cooldownMs != null ? cooldownMs : 60 * 1000 }))
            .catch(() => {});
    } catch (_) {}
}

module.exports = {
    SENSITIVE_KEY_RE,
    isSensitiveKey,
    maskSecret,
    sanitizeUserText,
    reportSensitive
};
