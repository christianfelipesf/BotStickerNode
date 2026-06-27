/* configDocs.js — descrições curtas das chaves de config do database.json
   Exibidas como label abaixo do nome em cada card do admin.
   Mantido separado para não poluir database/utils.js. */
(function (D) {
    'use strict';

    const DOCS = {
        botName: 'Nome do bot exibido em menus, figurinhas e respostas de IA.',
        prefix: 'Símbolo que inicia comandos (ex.: !, /, .). Afeta todos os grupos.',
        newsEnabled: 'Liga/desliga globalmente o serviço de notícias (subreddits).',
        dashboardUrl: 'URL pública do painel, usada em links de divulgação.',
        showLogoInMenu: 'Mostra o logotipo do bot no menu principal do WhatsApp.',
        voiceEffects: 'Aplica efeitos de voz em áudios (TTS) quando ligado.',
        aiModel: 'Modelo usado para IA e resumo de conversas (OpenRouter).',
        aiMaxTokens: 'Máx. de tokens na resposta da IA (corta respostas longas para economizar).',
        aiTemperature: 'Criatividade da IA (0=determinístico, 1=criativo, 2=imprevisível).',
        aiMaxPromptLength: 'Máx. de caracteres no prompt do usuário (corta automaticamente).',
        aiCacheTtl: 'Tempo (ms) que respostas idênticas ficam em cache (0=desliga cache).',
        aiRetryCount: 'Tentativas automáticas se a API falhar (ex.: rate limit).',
        openrouterApiKey: 'Chave da API OpenRouter. Salva no .env (não vai pro database.json).',
        summaryLimit: 'Qtde. de mensagens guardadas por grupo para !resumir (alto fluxo).',
        aiPrompt: 'Prompt base da IA. Use {botName} para o nome atual.',
        summaryPrompt: 'Prompt do !resumir — define tom/forma do resumo.',
        stickerPack: 'Nome do pack das figurinhas geradas.',
        stickerAuthor: 'Autor publicado nos EXIF das figurinhas.',

        dashboardEnabled: 'Liga/desliga o painel web do bot.',
        dashboardPort: 'Porta HTTP do painel (3000 por padrão).',
        dashboardMaxLogs: 'Máx. de linhas de log mantidas no banco antes do trim.',
        dashboardHistoryHours: 'Horas de histórico do chat carregadas ao abrir o painel.',
        adminCanControl: 'Permite admins dos grupos controlarem o bot (experimental).',
        clearDefaultLimit: 'Qtde. padrão de mensagens apagadas pelo !limpar.',
        partialWaitMs: 'Espera (ms) no modo parcial antes de responder se ninguém respondeu.',
        newsSubreddits: 'Lista de subreddits monitorados pelo serviço de notícias.',
        newsPollIntervalMinutes: 'Intervalo (min) entre coletas de posts novos.',
        newsUserAgent: 'User-Agent HTTP usado nas requisições ao Reddit.',
        newsSendDelayMs: 'Atraso (ms) entre envios de posts no mesmo grupo.',
        newsFetchStaggerMs: 'Stagger (ms) entre fetches de subreddits diferentes.',
        newsMaxPerCycle: 'Máx. de posts enviados por ciclo de coleta.',
        newsShowMeta: 'Mostra autor/upvotes ao enviar uma notícia.',
        newsRandomSub: 'Embaralha a ordem dos subreddits por ciclo.',
        newsOnePerCycle: 'Envia apenas 1 post por ciclo (evita flood).',
        newsMaxRetries: 'Tentativas em caso de erro ao buscar subreddit.',
        newsRetryBaseDelayMs: 'Atraso base (ms) entre tentativas de retry.',
        dashboardTrimIntervalMs: 'Intervalo (ms) do trim automático do dashboard_logs.',
        maxMediaDurationSeconds: 'Duração máxima (s) aceita para mídia enviada.',
        subSessionsGroups: 'Mantém sub-sessões separadas por grupo (anti-colisão).',
        dashboardMuted: 'Silencia notificações sonoras do painel por padrão.',
        dashboardShowQR: 'Mostra o QR Code de conexão no dashboard principal para visitantes.',
        linkgrupo: 'Link de divulgação exibido no comando !divulgar.'
    };

    D.configDocs = DOCS;
})(window.Dashboard = window.Dashboard || {});
