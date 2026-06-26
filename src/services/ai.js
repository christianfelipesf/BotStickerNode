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
        const oldest = [...responseCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) responseCache.delete(oldest[0]);
    }
}

// === Retry logic ===
function _buildBackoffs(baseMs) {
    const base = Math.max(500, Number(baseMs) || 2000);
    return [base, Math.round(base * 2), Math.round(base * 4), Math.round(base * 8)];
}

function _isRetryableError(err) {
    if (!err) return false;
    const status = err?.response?.status || err?.statusCode;
    if (status === 429 || status === 503 || status >= 500) return true;
    const msg = String(err.message || err || '').toLowerCase();
    return msg.includes('rate limit') || msg.includes('rate_limit') || msg.includes('timeout') || msg.includes('429') || msg.includes('503') || msg.includes('5');
}

function _isAuthError(err) {
    if (!err) return false;
    const status = err?.response?.status || err?.statusCode;
    if (status === 401 || status === 403) return true;
    const msg = String(err.message || err || '').toLowerCase();
    return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('invalid api key');
}

// === API call with retry ===
async function callWithRetry(apiKey, modelName, systemInstruction, prompt, maxTokens, temperature, retryCount) {
    const retries = Math.max(0, Math.min(3, Number(retryCount) || 1));
    const backoffs = _buildBackoffs(2000);

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const { data } = await axios.post(`${OPENROUTER_BASE}/chat/completions`, {
                model: modelName,
                max_tokens: maxTokens,
                temperature: temperature,
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
                timeout: 30000
            });

            const content = data?.choices?.[0]?.message?.content || '';
            const usage = data?.usage || {};

            usageStats.totalRequests++;
            usageStats.successfulRequests++;
            usageStats.totalTokensIn += usage.prompt_tokens || 0;
            usageStats.totalTokensOut += usage.completion_tokens || 0;

            return { text: content, tokensIn: usage.prompt_tokens || 0, tokensOut: usage.completion_tokens || 0, model: modelName, cached: false };

        } catch (err) {
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
            await new Promise(r => setTimeout(r, wait));
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
    const modelName = config.aiModel || 'openrouter/free';
    const systemInstruction = (config.aiPrompt || "Você é uma IA útil.").replace(/{botName}/g, config.botName || 'Bot');
    const maxTokens = Number(config.aiMaxTokens) || 500;
    const temperature = config.aiTemperature !== undefined ? Number(config.aiTemperature) : 0.7;
    const cacheTtl = Number(config.aiCacheTtl) || 300000;
    const retryCount = Number(config.aiRetryCount) || 2;
    const maxPromptLength = Number(config.aiMaxPromptLength) || 2000;

    model = {
        generateContent: async (prompt) => {
            if (!prompt || typeof prompt !== 'string') {
                throw new Error('Prompt inválido');
            }

            const truncatedPrompt = prompt.length > maxPromptLength
                ? prompt.slice(0, maxPromptLength) + '\n\n[Nota: o prompt foi truncado por exceder o limite de caracteres.]'
                : prompt;

            // Check cache first
            const cacheConfig = { systemInstruction, prompt: truncatedPrompt, modelName, cacheTtl };
            const cached = getCached(cacheConfig);
            if (cached) {
                return {
                    response: {
                        text: () => cached
                    },
                    cached: true
                };
            }

            const result = await callWithRetry(apiKey, modelName, systemInstruction, truncatedPrompt, maxTokens, temperature, retryCount);

            if (result.text) {
                setCached(cacheConfig, result.text);
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
