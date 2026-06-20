const { GoogleGenerativeAI } = require('@google/generative-ai');

let model;

function setupAI(config) {
    if (!config.geminiApiKey) return null;
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const systemInstruction = (config.aiPrompt || "Você é uma IA útil.").replace(/{botName}/g, config.botName);
    model = genAI.getGenerativeModel({ 
        model: config.geminiModel || "gemini-1.5-flash",
        systemInstruction: systemInstruction
    });
    return model;
}

function getModel() {
    return model;
}

module.exports = { setupAI, getModel };
