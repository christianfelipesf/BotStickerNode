const axios = require('axios');
const crypto = require('crypto');

let model;
let currentConfig = null;

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// === Usage tracking ===
const usageStats = {
    totalRequests: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cachedResponses: 0,
    startTime: Date.now()
};

// === Response cache ===
const responseCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;

function makeCacheKey(systemInstruction, prompt, modelName) {
    return crypto.createHash('md5').update(`${systemInstruction}|${prompt}|${modelName}`).digest('hex');
}

function getCached(promptConfig) {
    const { systemInstruction, prompt, modelName, cacheTtl } = promptConfig;
    if (!cacheTtl || cacheTtl <= 0) return null;
    const key = makeCacheKey(systemInstruction, prompt, modelName);
    const entry = responseCache.get(key);
    if (entry && Date.now() - entry.ts < cacheTtl) {
        cacheHits++;
        usageStats.cachedResponses++;
        return entry.text;
    }
    if (entry) responseCache.delete(key);
    cacheMisses++;
    return null;
}

function setCached(promptConfig, text) {
    const { systemInstruction, prompt, modelName, cacheTtl } = promptConfig;
    if (!cacheTtl || cacheTtl <= 0) return;
    const key = makeCacheKey(systemInstruction, prompt, modelName);
    responseCache.set(key, { text, ts: Date.now() });
    // LRU cleanup if cache grows too large
    if (responseCache.size > 500) {
        const firstKey = responseCache.keys().next().value;
        if (firstKey) responseCache.delete(firstKey);
    }
}

// === Retry logic ===
function _buildBackoffs(baseMs) {
    const base = Math.max(500, Number(baseMs) || 2000);
    return [base, Math.round(base * 2), Math.round(base * 4), Math.round(base * 8)];
}

// Timeout por tentativa (ms). Orçamento total do comando é CMD_TIMEOUT_MS (45s):
// 20s + 2s backoff + 20s = 42s < 45s com retryCount padrão 1.
const ATTEMPT_TIMEOUT_MS = 20000;

function _sleepAbortable(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(Object.assign(new Error('Comando interrompido por timeout'), { code: 'ABORTED' }));
        const t = setTimeout(() => { cleanup(); resolve(); }, ms);
        const onAbort = () => { clearTimeout(t); cleanup(); reject(Object.assign(new Error('Comando interrompido por timeout'), { code: 'ABORTED' })); };
        function cleanup() { try { signal?.removeEventListener?.('abort', onAbort); } catch (_) {} }
        try { signal?.addEventListener?.('abort', onAbort, { once: true }); } catch (_) {}
    });
}

function _isAbortError(err, signal) {
    if (signal?.aborted) return true;
    const code = err?.code;
    return code === 'ERR_CANCELED' || code === 'ABORTED' || code === 'ECONNABORTED' && signal?.aborted;
}

function _isRetryableError(err) {
    if (!err) return false;
    const status = err?.response?.status || err?.statusCode;
    if (status === 429 || status === 503 || status >= 500) return true;
    const msg = String(err.message || err || '').toLowerCase();
    // Resposta vazia (ex.: reasoning consumiu todo o max_tokens, finish_reason=length)
    // é transitória na maioria das vezes -> permite 1 retry em vez de entregar vazio.
    if (msg.includes('resposta vazia') || msg.includes('empty response') || msg.includes('finish_reason=length')) return true;
    return msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('timeout') || msg.includes('429') || msg.includes('503') || /\b5\d\d\b/.test(msg);
}

function _isAuthError(err) {
    if (!err) return false;
    const status = err?.response?.status || err?.statusCode;
    if (status === 401 || status === 403) return true;
    const msg = String(err.message || err || '').toLowerCase();
    return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('invalid api key');
}

// Extrai o texto útil da resposta OpenRouter.
// Modelos reasoning (ex.: nemotron-*-reasoning) devolvem o raciocínio em
// message.reasoning / message.reasoning_content e podem vir com
// message.content vazio quando o reasoning consome todo o max_tokens
// (finish_reason=length). Nunca retorna reasoning como resposta final:
// vazio aqui vira erro retryable para o comando responder com erro claro
// em vez de mensagem vazia no WhatsApp.
function _extractContent(data) {
    const choice = data?.choices?.[0] || {};
    const msg = choice?.message || {};
    let content = msg?.content ?? choice?.text ?? '';
    if (Array.isArray(content)) {
        content = content.map(p => (typeof p === 'string' ? p : (p?.text || ''))).join('');
    }
    const text = String(content ?? '').trim();
    const finish = choice?.finish_reason || '';
    const reasoning = String(msg?.reasoning || msg?.reasoning_content || '').trim();
    return { text, finish, hasReasoning: reasoning.length > 0 };
}

function _isReasoningModel(modelName) {
    return /reasoning|thinking|reasoner|deepseek-r1|qwen3|nemotron.*nano/i.test(String(modelName || ''));
}

// === API call with retry ===
async function callWithRetry(apiKey, modelName, systemInstruction, prompt, maxTokens, temperature, retryCount, signal) {
    const retries = Math.max(0, Math.min(3, Number(retryCount) || 1));
    const backoffs = _buildBackoffs(2000);
    // Reasoning consome o mesmo budget de max_tokens. Com 500 tokens o modelo
    // gasta tudo pensando e devolve content="". Garante piso p/ reasoning.
    const effectiveMaxTokens = _isReasoningModel(modelName)
        ? Math.max(Number(maxTokens) || 500, 1500)
        : (Number(maxTokens) || 500);

    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) throw Object.assign(new Error('Comando interrompido por timeout'), { code: 'ABORTED' });
        try {
            const { data } = await axios.post(`${OPENROUTER_BASE}/chat/completions`, {
                model: modelName,
                max_tokens: effectiveMaxTokens,
                temperature: temperature,
                // effort low (~20% p/ reasoning) deixa ~80% p/ resposta.
                // exclude:true omite o bloco reasoning do payload (economiza banda).
                ...(_isReasoningModel(modelName) ? { reasoning: { effort: 'low', exclude: true } } : {}),
                messages: [
                    { role: 'system', content: systemInstruction },
                    { role: 'user', content: prompt }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://github.com/BotStickerNode',
                    'X-Title': 'BotStickerNode',
                    'Content-Type': 'application/json'
                },
                timeout: ATTEMPT_TIMEOUT_MS,
                signal
            });

            const { text, finish, hasReasoning } = _extractContent(data);
            const usage = data?.usage || {};

            if (!text) {
                const emptyErr = new Error(`Resposta vazia da IA (finish_reason=${finish || 'desconhecido'}${hasReasoning ? ', com reasoning' : ''})`);
                console.warn(`⚠️ [IA] Tentativa ${attempt + 1}/${retries + 1}: ${emptyErr.message} | modelo=${modelName} | prompt=${String(prompt).slice(0, 80)}...`);
                throw emptyErr;
            }

            usageStats.totalRequests++;
            usageStats.successfulRequests++;
            usageStats.totalTokensIn += usage.prompt_tokens || 0;
            usageStats.totalTokensOut += usage.completion_tokens || 0;

            return { text, tokensIn: usage.prompt_tokens || 0, tokensOut: usage.completion_tokens || 0, model: modelName, cached: false };

        } catch (err) {
            if (_isAbortError(err, signal)) {
                usageStats.totalRequests++;
                usageStats.failedRequests++;
                throw Object.assign(new Error('Comando interrompido por timeout'), { code: 'ABORTED' });
            }
            if (_isAuthError(err)) {
                usageStats.totalRequests++;
                usageStats.failedRequests++;
                throw new Error('Chave de API inválida ou sem acesso ao modelo');
            }
            if (!_isRetryableError(err) || attempt >= retries) {
                usageStats.totalRequests++;
                usageStats.failedRequests++;
                throw err;
            }
            const wait = backoffs[attempt] || backoffs[backoffs.length - 1];
            await _sleepAbortable(wait, signal);
        }
    }

    throw new Error('Falha na comunicação com a IA');
}

function setupAI(config) {
    currentConfig = config;
    if (!config.openrouterApiKey) {
        model = null;
        return null;
    }

    const apiKey = config.openrouterApiKey;
    const modelName = config.aiModel || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
    const systemInstruction = (config.aiPrompt || "Você é uma IA útil.").replace(/{botName}/g, config.botName || 'Bot');
    const maxTokens = Number(config.aiMaxTokens) || 500;
    const temperature = config.aiTemperature !== undefined ? Number(config.aiTemperature) : 0.7;
    const cacheTtl = Number(config.aiCacheTtl) || 300000;
    const retryCount = Number(config.aiRetryCount) || 2;
    const maxPromptLength = Number(config.aiMaxPromptLength) || 2000;

    model = {
        generateContent: async (prompt, opts = {}) => {
            if (!prompt || typeof prompt !== 'string') {
                throw new Error('Prompt inválido');
            }
            const signal = opts?.signal;

            const truncatedPrompt = prompt.length > maxPromptLength
                ? prompt.slice(0, maxPromptLength) + '\n\n[Nota: o prompt foi truncado por exceder o limite de caracteres.]'
                : prompt;

            // Check cache first (ignora cache vazio de versões antigas)
            const cacheConfig = { systemInstruction, prompt: truncatedPrompt, modelName, cacheTtl };
            const cached = getCached(cacheConfig);
            if (cached && String(cached).trim()) {
                return {
                    response: {
                        text: () => cached
                    },
                    cached: true
                };
            }

            const result = await callWithRetry(apiKey, modelName, systemInstruction, truncatedPrompt, maxTokens, temperature, retryCount, signal);

            if (result.text && String(result.text).trim()) {
                setCached(cacheConfig, String(result.text).trim());
            }

            return {
                response: {
                    text: () => result.text
                },
                tokensIn: result.tokensIn,
                tokensOut: result.tokensOut,
                model: result.model,
                cached: result.cached
            };
        }
    };

    return model;
}

function getModel() {
    return model;
}

function getUsageStats() {
    return {
        ...usageStats,
        cacheHits,
        cacheMisses,
        uptimeMs: Date.now() - usageStats.startTime,
        cacheSize: responseCache.size,
        config: currentConfig ? {
            aiModel: currentConfig.aiModel,
            aiMaxTokens: currentConfig.aiMaxTokens,
            aiTemperature: currentConfig.aiTemperature,
            aiCacheTtl: currentConfig.aiCacheTtl,
            aiRetryCount: currentConfig.aiRetryCount,
            aiMaxPromptLength: currentConfig.aiMaxPromptLength
        } : null
    };
}

function resetUsageStats() {
    usageStats.totalRequests = 0;
    usageStats.totalTokensIn = 0;
    usageStats.totalTokensOut = 0;
    usageStats.successfulRequests = 0;
    usageStats.failedRequests = 0;
    usageStats.cachedResponses = 0;
    usageStats.startTime = Date.now();
}

module.exports = { setupAI, getModel, getUsageStats, resetUsageStats };
