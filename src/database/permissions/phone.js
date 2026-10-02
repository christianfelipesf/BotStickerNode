// Funções puras de normalização JID/telefone.
// Extraído de src/database/utils.js (quebra parcial) — zero dependências
// de banco (better-sqlite3/sharp). Seguro para testes unitários leves.
'use strict';

function normalizeJid(jid) {
    if (!jid) return jid;
    const [rawUser, domain] = jid.split('@');
    const [user] = rawUser.split(':');
    return `${user}@${domain || 's.whatsapp.net'}`;
}

function normalizeBlacklistJid(jid) {
    if (!jid) return null;
    try { return normalizeJid(jid); } catch (_) { return null; }
}

function normalizePhoneNumber(raw, { min = 8 } = {}) {
    // Aceita qualquer formatação: "+55 13 93631-2912", "(13) 93631-2912",
    // "13 93631-2912", "5513936312912". Extrai só dígitos do texto inteiro
    // (não quebra em pedaços) e completa o DDI 55 quando for número BR
    // com DDD mas sem país (10 ou 11 dígitos).
    if (raw == null) return null;
    let digits = String(raw).replace(/\D/g, '');
    if (!digits) return null;
    // Prefixo internacional "00" (ex: 0055...) -> remove
    if (digits.length > 11 && digits.startsWith('00')) digits = digits.slice(2);
    // BR sem DDI: 10 dígitos (DDD + 8) ou 11 (DDD + 9) -> prepende 55.
    // 12/13 dígitos com 55 na frente já estão completos; demais tamanhos
    // (estrangeiros) são mantidos como estão.
    if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
    if (digits.length < min || digits.length > 15) return null;
    return digits;
}

function extractPhoneFromText(text, opts) {
    // Wrapper p/ comandos: extrai o número do texto completo já com a
    // normalização BR (evita o bug de match(/\d{8,15}/g) que quebra
    // "+55 13 93631-2912" em ["13","93631","2912"]).
    return normalizePhoneNumber(text, opts);
}

function parseNumberToJid(raw) {
    const digits = normalizePhoneNumber(raw);
    if (!digits) return null;
    return `${digits}@s.whatsapp.net`;
}

// Login permitido (!addlogin / !login) — números autorizados pelo dono
function normalizeLoginPhone(raw) {
    return normalizePhoneNumber(raw);
}

module.exports = {
    normalizeJid,
    normalizeBlacklistJid,
    normalizePhoneNumber,
    extractPhoneFromText,
    parseNumberToJid,
    normalizeLoginPhone,
};
