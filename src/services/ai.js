const axios = require('axios');

let model;

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function setupAI(config) {
    if (!config.openrouterApiKey) return null;

    const apiKey = config.openrouterApiKey;
    const modelName = config.aiModel || 'openrouter/free';
    const systemInstruction = (config.aiPrompt || "Você é uma IA útil.").replace(/{botName}/g, config.botName);

    model = {
        generateContent: async (prompt) => {
            const { data } = await axios.post(`${OPENROUTER_BASE}/chat/completions`, {
                model: modelName,
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
                }
            });
            return {
                response: {
                    text: () => data.choices[0].message.content
                }
            };
        }
    };

    return model;
}

function getModel() {
    return model;
}

module.exports = { setupAI, getModel };
