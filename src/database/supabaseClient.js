// Cliente Supabase via PostgREST (fetch nativo, sem dependência nova).
// Usa SUPABASE_URL + SUPABASE_SECRET_KEY (sb_secret_...) do .env.
// DDL NÃO é possível via REST: rode src/database/supabaseSchema.sql
// uma vez no SQL Editor do dashboard antes do primeiro sync.
require('dotenv').config();

function _cfg() {
    const rawUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
    return { url: rawUrl, key };
}

function isSupabaseEnabled() {
    const { url, key } = _cfg();
    return !!(url && key && /^https:\/\//i.test(url));
}

function getSupabaseConfig() {
    const { url, key } = _cfg();
    if (!url || !key) return null;
    return { url, key };
}

async function supaFetch(path, { method = 'GET', body, prefer, signal } = {}) {
    const conf = getSupabaseConfig();
    if (!conf) throw new Error('Supabase não configurado (SUPABASE_URL / SUPABASE_SECRET_KEY ausentes)');
    const headers = {
        apikey: conf.key,
        Authorization: `Bearer ${conf.key}`,
        'Content-Type': 'application/json',
    };
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${conf.url}/rest/v1${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    if (!res.ok) {
        const msg = (data && (data.message || data.hint || data.details))
            ? `${data.message}${data.hint ? ' — ' + data.hint : ''}`
            : `HTTP ${res.status}: ${String(text).slice(0, 300)}`;
        const err = new Error(msg);
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

// Lê TODAS as linhas (pagina de 1000 em 1000, limite de segurança de 20k).
async function supaSelectAll(table, { order = null, desc = true, limit = 20000 } = {}) {
    const out = [];
    const pageSize = 1000;
    let offset = 0;
    while (out.length < limit) {
        const take = Math.min(pageSize, limit - out.length);
        let path = `/${table}?select=*&limit=${take}&offset=${offset}`;
        if (order) path += `&order=${encodeURIComponent(order)}.${desc ? 'desc' : 'asc'}`;
        const rows = await supaFetch(path);
        if (!Array.isArray(rows) || !rows.length) break;
        out.push(...rows);
        if (rows.length < take) break;
        offset += rows.length;
        if (offset >= limit) break;
    }
    return out;
}

async function supaCount(table) {
    // count exato via HEAD + Prefer: count=exact
    const conf = getSupabaseConfig();
    if (!conf) throw new Error('Supabase não configurado');
    const res = await fetch(`${conf.url}/rest/v1/${table}?select=*&limit=1`, {
        method: 'HEAD',
        headers: {
            apikey: conf.key,
            Authorization: `Bearer ${conf.key}`,
            Prefer: 'count=exact',
        },
    });
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        if (/not find|does not exist|relation/i.test(t) || res.status === 404) return 0;
        throw new Error(`count ${table}: HTTP ${res.status}: ${String(t).slice(0, 200)}`);
    }
    const cr = res.headers.get('content-range');
    // formato "0-0/123"
    const m = cr && cr.match(/\/(\d+|\*)/);
    if (m && m[1] !== '*') return Number(m[1]);
    return -1;
}

async function supaUpsert(table, rows, onConflict) {
    if (!rows.length) return 0;
    const BATCH = 300;
    let done = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        // undefined -> null (PostgREST/JSON não aceita undefined)
        const clean = chunk.map(r => {
            const o = {};
            for (const [k, v] of Object.entries(r)) o[k] = (v === undefined ? null : v);
            return o;
        });
        const path = onConflict ? `/${table}?on_conflict=${encodeURIComponent(onConflict)}` : `/${table}`;
        await supaFetch(path, {
            method: 'POST',
            body: clean,
            prefer: 'resolution=merge-duplicates,return=minimal',
        });
        done += clean.length;
    }
    return done;
}

async function pingSupabase() {
    if (!isSupabaseEnabled()) return { ok: false, reason: 'not-configured' };
    try {
        await supaFetch('/config?select=key&limit=1');
        return { ok: true };
    } catch (e) {
        const msg = e?.message || String(e);
        // Tabela ainda não criada -> conectado, mas schema pendente
        if (/not find|does not exist|relation/i.test(msg) || e?.status === 404) {
            return { ok: true, warning: 'conectado, mas tabela config não existe — rode supabaseSchema.sql no SQL Editor' };
        }
        return { ok: false, reason: msg };
    }
}

// Não cria DDL via REST; só verifica quais tabelas respondem.
async function ensureSupabaseSchema(tables = []) {
    if (!isSupabaseEnabled()) throw new Error('Supabase não configurado (SUPABASE_URL/SECRET_KEY ausentes)');
    const missing = [];
    for (const t of tables) {
        try {
            await supaFetch(`/${t}?select=*&limit=1`);
        } catch (e) {
            if (/not find|does not exist|relation/i.test(e?.message || '') || e?.status === 404) missing.push(t);
            else throw e;
        }
    }
    if (missing.length) {
        throw new Error(`Schema pendente no Supabase (tabelas ausentes: ${missing.join(', ')}). Rode src/database/supabaseSchema.sql no SQL Editor do dashboard.`);
    }
    return { ok: true };
}

module.exports = {
    isSupabaseEnabled,
    getSupabaseConfig,
    supaFetch,
    supaSelectAll,
    supaCount,
    supaUpsert,
    pingSupabase,
    ensureSupabaseSchema,
    getRemoteSchema,
    diffLocalVsRemote,
    sqliteTypeToPostgres,
};

// Lê o schema remoto via spec OpenAPI do PostgREST.
// Retorna { table: { col: pgType } }. null se a spec não estiver acessível.
async function getRemoteSchema() {
    const conf = getSupabaseConfig();
    if (!conf) throw new Error('Supabase não configurado');
    const res = await fetch(`${conf.url}/rest/v1/`, {
        headers: {
            apikey: conf.key,
            Authorization: `Bearer ${conf.key}`,
            Accept: 'application/openapi+json',
        },
    });
    if (!res.ok) return null;
    const spec = await res.json();
    const out = {};
    const defs = spec.definitions || spec.components?.schemas || {};
    for (const [name, def] of Object.entries(defs)) {
        if (!def || typeof def !== 'object' || !def.properties) continue;
        out[name] = {};
        for (const [col, prop] of Object.entries(def.properties)) {
            out[name][col] = prop.format || prop.type || 'unknown';
        }
    }
    return out;
}

function sqliteTypeToPostgres(declType, table, col) {
    // Exceção conhecida: stats.value é TEXT na nuvem (mistura inteiros e 'YYYY-MM').
    if (table === 'stats' && col === 'value') return 'TEXT';
    const t = String(declType || '').toUpperCase();
    if (t.includes('INT')) return 'BIGINT';
    if (t.includes('CHAR') || t.includes('CLOB') || t.includes('TEXT')) return 'TEXT';
    if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'DOUBLE PRECISION';
    if (t.includes('BLOB')) return 'BYTEA';
    if (t.includes('NUMERIC') || t.includes('DECIMAL')) return 'NUMERIC';
    return 'TEXT';
}

// Compara bot.db local (PRAGMA) com o schema remoto (OpenAPI).
// Retorna { missingTables: [], missingColumns: [{table, column, pgType}], sql }.
function diffLocalVsRemote(localDb, tables, remote) {
    const missingTables = [];
    const missingColumns = [];
    for (const table of tables) {
        let localCols = [];
        try {
            localCols = localDb.prepare(`PRAGMA table_info("${table}")`).all();
        } catch (_) { continue; }
        if (!localCols.length) continue;
        const remoteCols = remote?.[table];
        if (!remoteCols) { missingTables.push(table); continue; }
        for (const c of localCols) {
            if (!(c.name in remoteCols)) {
                missingColumns.push({
                    table,
                    column: c.name,
                    pgType: sqliteTypeToPostgres(c.type, table, c.name),
                });
            }
        }
    }
    const lines = [];
    for (const m of missingColumns) {
        lines.push(`ALTER TABLE ${m.table} ADD COLUMN IF NOT EXISTS ${m.column} ${m.pgType};`);
    }
    return {
        missingTables,
        missingColumns,
        sql: lines.join('\n'),
        needsFullSchema: missingTables.length > 0,
    };
}
