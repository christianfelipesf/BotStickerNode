const fs = require('fs');
const path = require('path');

function normalizeNome(nome) {
    return String(nome || '')
        .trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .slice(0, 40);
}

function parseNascimento(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
        const d = Number(m[1]); const mo = Number(m[2]); const y = Number(m[3]);
        if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
        const dt = new Date(y, mo - 1, d);
        if (dt.getDate() !== d || dt.getMonth() !== mo - 1) return null;
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return null;
}

function formatNascimento(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(iso);
    return `${m[3]}/${m[2]}/${m[1]}`;
}

function calcIdade(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const now = new Date();
    let age = now.getFullYear() - Number(m[1]);
    const mo = now.getMonth() + 1 - Number(m[2]);
    if (mo < 0 || (mo === 0 && now.getDate() < Number(m[3]))) age--;
    return age >= 0 && age < 150 ? age : null;
}

function formatFicha(p, botName) {
    const nasc = formatNascimento(p.nascimento);
    const idade = calcIdade(p.nascimento);
    const nascLine = idade != null ? `${nasc} (${idade} anos)` : nasc;
    const lines = [
        `╭─── *📇 FICHA DE PERFIL* ───`,
        `│ 👤 *Nome:* ${p.nome}`,
        `│ 🎂 *Nascimento:* ${nascLine}`,
        `│ 📍 *Cidade:* ${p.cidade || '—'}`,
    ];
    const extras = [];
    if (p.status) extras.push(`💬 Status: ${p.status}`);
    if (p.hobby) extras.push(`🎮 Hobby: ${p.hobby}`);
    if (extras.length) lines.push(`│ ${extras.join(' | ')}`);
    lines.push(`│ 📝 *Descrição:* ${p.descricao || '—'}`);
    if (botName) lines.push(`│ 🤖 *Por:* ${botName}`);
    lines.push(`╰───────────────`);
    return lines.join('\n');
}

function formatContato(p, botName) {
    const lines = [
        `╭─── *📇 CONTATO* ───`,
        `│ 👤 *Nome:* ${p.nome}`,
    ];
    if (p.pix) lines.push(`│ 💸 *PIX:* ${p.pix}`);
    if (p.instagram) lines.push(`│ 📸 *Instagram:* ${p.instagram}`);
    if (p.linkedin) lines.push(`│ 💼 *LinkedIn:* ${p.linkedin}`);
    if (!p.pix && !p.instagram && !p.linkedin) lines.push(`│ _Nenhum contato cadastrado._`);
    if (botName) lines.push(`│ 🤖 *Por:* ${botName}`);
    lines.push(`╰───────────────`);
    return lines.join('\n');
}

function readFotoBuffer(fotoPath) {
    try {
        if (!fotoPath) return null;
        const full = path.resolve(process.cwd(), fotoPath);
        const uploadsDir = path.resolve(process.cwd(), 'uploads');
        if (!full.startsWith(uploadsDir + path.sep)) return null;
        if (!fs.existsSync(full)) return null;
        const buf = fs.readFileSync(full);
        if (!buf || buf.length < 100 || buf.length > 5 * 1024 * 1024) return null;
        return buf;
    } catch (_) { return null; }
}

// Parse "Nome | 15/08/2000 | Cidade | Descrição | Status | Hobby"
// Também aceita "campo=valor" em qualquer parte após o nome.
function parseCadastroPipe(fullArgsText) {
    const out = {};
    const raw = String(fullArgsText || '').trim();
    if (!raw) return out;
    const parts = raw.split('|').map(s => s.trim()).filter((s, i, a) => i === 0 || s !== '' || i < a.length);
    const FIELD_RE = /^(nome|nascimento|data|cidade|descricao|descrição|status|hobby|pix|instagram|insta|linkedin)\s*[:=]\s*(.+)$/i;
    const positional = ['nome', 'nascimento', 'cidade', 'descricao', 'status', 'hobby'];
    let posIdx = 0;
    for (const part of parts) {
        if (!part) { posIdx++; continue; }
        const fm = part.match(FIELD_RE);
        if (fm) {
            let k = fm[1].toLowerCase();
            if (k === 'data') k = 'nascimento';
            if (k === 'descrição') k = 'descricao';
            if (k === 'insta') k = 'instagram';
            out[k] = fm[2].trim();
        } else if (posIdx < positional.length) {
            // só preenche se ainda não definido via campo=
            if (out[positional[posIdx]] === undefined) out[positional[posIdx]] = part;
            else {
                // acha próxima posição livre
                const free = positional.findIndex((k, i) => i >= posIdx && out[k] === undefined);
                if (free >= 0) out[positional[free]] = part;
            }
            posIdx++;
        }
    }
    return out;
}

const FICHA_FIELDS = new Set(['nome', 'nascimento', 'cidade', 'descricao', 'status', 'hobby', 'pix', 'instagram', 'linkedin']);
const FICHA_LIMITS = { nome: 40, nascimento: 10, cidade: 60, descricao: 300, status: 60, hobby: 60, pix: 100, instagram: 60, linkedin: 120 };

module.exports = {
    normalizeNome,
    parseNascimento,
    formatNascimento,
    calcIdade,
    formatFicha,
    formatContato,
    readFotoBuffer,
    parseCadastroPipe,
    FICHA_FIELDS,
    FICHA_LIMITS
};
