// Splash do bot — curiosidades legais + dicas de uso, estilo tela de loading.
// Frases curtas, 1-2 linhas cada, PT-BR. Sorteadas a cada N mensagens
// pelo serviço src/services/splash.js (rotação por grupo, sem repetir).
const CURIOSIDADES = [
    // --- Figurinhas ---
    'Figurinhas do WhatsApp são arquivos WebP animados ou estáticos de até 512px. O bot converte tudo pra você!',
    'Dica: responda uma foto, vídeo ou GIF com !s e vira figurinha na hora.',
    'Dica: !rename pack/autor personaliza o nome do pack das suas figurinhas.',
    'Dica: !toimg transforma qualquer figurinha de volta em foto ou GIF.',
    'Dica: !stexto escreve qualquer frase e gera uma figurinha só com texto.',
    'Você sabia? Dá pra criar figurinha até de print de conversa com !s.',
    'Você sabia? Vídeos curtos viram figurinhas animadas automaticamente.',
    // --- Mídia revelada ---
    'Mensagens de visualização única sumem depois de abertas — mas o !revelar mostra o conteúdo se você responder a tempo.',
    'Dica: respondeu uma mensagem “ver uma vez”? Use !revelar antes que suma.',
    // --- Música e download ---
    'Dica: !play <nome da música> baixa o áudio e manda direto no chat.',
    'Dica: !dl <link> baixa vídeo ou áudio de YouTube, Instagram, TikTok e mais.',
    'Dica: !tts <texto> converte qualquer frase em mensagem de voz.',
    'O bot usa yt-dlp + ffmpeg por baixo dos panos para baixar e converter mídias.',
    'Dica: !acelerar deixa áudios e vídeos mais rápidos; !desacelerar faz o inverso.',
    // --- IA e texto ---
    'Dica: !ai <pergunta> conversa com a IA direto no grupo, sem sair do chat.',
    'Dica: !traduzir <texto> traduz qualquer idioma para português.',
    'Dica: !resumir resume as últimas mensagens — perfeito pra quem chegou agora.',
    'Você sabia? A IA do bot roda via OpenRouter e o modelo pode ser trocado nas configs.',
    'Você sabia? Respostas repetidas da IA ficam em cache pra responder mais rápido.',
    // --- Rank e atividade ---
    'Dica: !rank mostra o top 10 membros mais ativos do mês.',
    'Você sabia? Comandos não contam pontos no rank — só conversa de verdade.',
    'Você sabia? O próprio bot nunca aparece no próprio ranking.',
    'Dica: !perfil mostra sua foto e suas estatísticas no grupo.',
    'Dica: !inativos revela quem está há mais tempo sem falar nada.',
    'Dica: !infogrupo mostra horários de pico e movimento da semana.',
    // --- Fichas e diversão ---
    'Dica: !ficha <nome> abre a ficha cadastrada de alguém.',
    'Dica: !aniversariantes lista quem faz aniversário neste mês.',
    'Dica: !radar-cidades agrupa todas as fichas por cidade.',
    'Dica: !aleatorio sorteia uma ficha cadastrada aleatória.',
    'Dica: !enquete <pergunta> cria uma votação rápida no grupo.',
    // --- Interação ---
    'Dica: !comandosinteracao lista todos os comandos de interação (beijo, abraço, tapa...).',
    'Você sabia? Beijar, abraçar, dar tapa, soco, cafuné e cutucar são comandos animados com GIF.',
    'Dica: !abraco @pessoa manda um abraço animado no meio da conversa.',
    'Dica: !mencionar marca todos os membros do grupo de uma vez.',
    // --- Segredos (shhh) ---
    '⚠️ Aviso sério: nunca digite !nuke no grupo. Sério. Não teste. Não seja curioso.',
    '🤫 Boato: existe um !menusecreto com comandos ocultos... mas ninguém nunca confirmou.',
    // --- Admin e moderação ---
    'Dica (admin): !bemvindo on ativa mensagem automática para quem entra.',
    'Dica (admin): !avisosgrupo on ativa avisos de saída, promoção e rebaixamento.',
    'Dica (admin): !antilink on apaga links suspeitos automaticamente.',
    'Dica (admin): !antiflood on bloqueia quem flooda mensagens seguidas.',
    'Dica (admin): !mute @pessoa silencia alguém; !desmute libera.',
    'Dica (admin): !ban remove o membro (responda a mensagem dele).',
    'Dica (admin): !promover e !rebaixar gerenciam os administradores.',
    'Dica (admin): !add <número com DDD> adiciona alguém direto pelo número.',
    'Dica (admin): !fechar trava o grupo só para admins; !abrir libera.',
    'Dica (admin): !limpar apaga as últimas mensagens do bot no chat.',
    'Você sabia? O bot registra advertências — !veradv mostra o histórico do membro.',
    // --- Personalização ---
    'Dica: !tema troca as cores do menu e dos cards gerados no grupo.',
    'Dica: !setprefix muda o símbolo dos comandos só neste grupo.',
    'Dica: !imagem define uma imagem personalizada para o menu do grupo.',
    'Dica: !regras exibe as regras cadastradas do grupo.',
    'Dica: !linkgp mostra o link de convite do grupo na hora.',
    // --- Sistema ---
    'Você sabia? O bot tem painel web com logs, QR code e estatísticas em tempo real.',
    'Dica: !status mostra versão, uptime e saúde do bot.',
    'Dica: !ping mede o tempo de resposta em milissegundos.',
    'Dica: !tutorial ensina o passo a passo dos principais recursos.',
    'Dica: !menu mostra os comandos gerais; !menuadmin, !menudono e !menusecreto mostram os restritos e ocultos.',
    'Dica: !bug <mensagem> reporta um problema direto ao dono do bot.',
    'Dica: !sugestao <ideia> envia sua ideia de melhoria.',
    'Você sabia? Todo comando tem cooldown anti-spam de alguns segundos.',
    'Você sabia? Se o bot responder “🔄 conexão instável”, é só tentar de novo em segundos.',
    'Você sabia? Figurinhas, áudios e imagens passam por fila pra não travar o grupo.',
    'Curiosidade: o WhatsApp limita figurinhas a 512x512 — por isso às vezes a imagem é recortada.',
    'Curiosidade: áudios do WhatsApp usam o codec Opus — o bot converte tudo pra esse formato.',
    'Curiosidade: o bot conta mensagens por hora pra descobrir o horário mais ativo do grupo.',
    'Dica de loading: digite !menu uma vez e descubra metade do que o bot faz.'
];

module.exports = CURIOSIDADES;

// Pool do modo parcial (!ativarp): SÓ dicas de comandos liberados no parcial
// (mídia + interação + !tts + bypass) e curiosidades neutras. Nada aqui pode
// citar comando de PARTIAL_BLOCKED_COMMANDS (menu, rank, ai, resumir, admin...),
// senão o splash anunciaria algo que o bot ignora em silêncio no parcial.
const CURIOSIDADES_PARCIAL = [
    // --- Modo parcial ---
    '🟡 Este grupo está em modo parcial: funcionam comandos de mídia, interação e voz (!tts).',
    'Dica: !statusp mostra a saúde do bot sem sair do modo parcial.',
    'Dica: no modo parcial o bot espera alguns segundos antes de responder, caso outro bot reaja primeiro.',
    'Dica: !ativar volta o bot ao modo total neste grupo (dono ou admins).',
    // --- Figurinhas (mídia) ---
    'Figurinhas do WhatsApp são arquivos WebP animados ou estáticos de até 512px. O bot converte tudo pra você!',
    'Dica: responda uma foto, vídeo ou GIF com !s e vira figurinha na hora.',
    'Dica: !rename pack/autor personaliza o nome do pack das suas figurinhas.',
    'Dica: !toimg transforma qualquer figurinha de volta em foto ou GIF.',
    'Dica: !stexto escreve qualquer frase e gera uma figurinha só com texto.',
    'Você sabia? Dá pra criar figurinha até de print de conversa com !s.',
    'Você sabia? Vídeos curtos viram figurinhas animadas automaticamente.',
    // --- Mídia revelada / velocidade ---
    'Mensagens de visualização única sumem depois de abertas — mas o !revelar mostra o conteúdo se você responder a tempo.',
    'Dica: respondeu uma mensagem "ver uma vez"? Use !revelar antes que suma.',
    'Dica: !acelerar deixa áudios e vídeos mais rápidos.',
    // --- Música, download e voz ---
    'Dica: !play <nome da música> baixa o áudio e manda direto no chat.',
    'Dica: !dl <link> baixa vídeo ou áudio de YouTube, Instagram, TikTok e mais.',
    'Dica: !tts <texto> converte qualquer frase em mensagem de voz.',
    // --- Interação ---
    'Dica: !comandosinteracao lista todos os comandos de interação (beijo, abraço, tapa...).',
    'Você sabia? Beijar, abraçar, dar tapa, soco, cafuné e cutucar são comandos animados com GIF.',
    'Dica: !abraco @pessoa manda um abraço animado no meio da conversa.',
    // --- Neutras (valem em qualquer modo) ---
    'Você sabia? Todo comando tem cooldown anti-spam de alguns segundos.',
    'Você sabia? Se o bot responder "🔄 conexão instável", é só tentar de novo em segundos.',
    'Você sabia? Figurinhas, áudios e imagens passam por fila pra não travar o grupo.',
    'Curiosidade: o WhatsApp limita figurinhas a 512x512 — por isso às vezes a imagem é recortada.',
    'Curiosidade: áudios do WhatsApp usam o codec Opus — o bot converte tudo pra esse formato.'
];

module.exports.CURIOSIDADES_PARCIAL = CURIOSIDADES_PARCIAL; 
