# BotStickerNode 🌌
Bot multifuncional para WhatsApp com IA, dashboard administrativo, sub-sessões, downloads de mídias sociais e muito mais.

## 🚀 Funcionalidades Principais
- **Download de Mídias:** Baixe vídeos e áudios do TikTok, Instagram, YouTube, Facebook, Reddit e Google Imagens.
- **Inteligência Artificial:** Integrado com OpenRouter (Gemini, GPT, Grok) para conversas e resumos de chat.
- **Figurinhas:** Criação de figurinhas estáticas e animadas com metadados personalizados.
- **Conversão:** Converta figurinhas de volta para imagens/vídeos e vice-versa.
- **Privacidade:** Bypass automático de mensagens de visualização única (View Once).
- **Dashboard Web:** Painel administrativo em tempo real com logs, mídias e gerenciamento.
- **Sub-Sessões:** Múltiplas sessões do WhatsApp com prefixos próprios e comandos restritos.
- **TTS Offline:** Sintetizador de voz Piper integrado para mensagens de áudio realistas.
- **Notícias Reddit:** Feed automático de notícias em grupos ativados.
- **Moderação:** Sistema de mute, anti-link, advertências e banimento automático.
- **Tradução:** Tradução de textos entre 100+ idiomas.

## 💻 Instalação (VPS Linux - Recomendado)

```bash
git clone https://github.com/christianfelipesf/BotStickerNode
cd BotStickerNode
# Configure o .env com sua chave OPENROUTER_API_KEY
cp .env.example .env
docker-compose up -d
```

### Instalação Manual (Ubuntu/Debian)
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install nodejs ffmpeg python3 curl -y
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Piper TTS (opcional)
sudo mkdir -p /opt/piper
sudo curl -L https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz | sudo tar xz -C /opt/piper

npm install
node index.js
```

## 📱 Instalação (Termux)
```bash
pkg update && pkg upgrade
pkg install nodejs ffmpeg python3 curl libwebp libvips -y
pip install yt-dlp

git clone https://github.com/christianfelipesf/BotStickerNode
cd BotStickerNode
npm install
node index.js
```

## 🤖 Comandos Principais

### Mídia
| Comando | Descrição |
|---------|-----------|
| `!s` | Criar figurinha (imagem/vídeo/gif) |
| `!stexto` | Criar figurinha de texto |
| `!toimg` | Converter figurinha de volta para imagem/vídeo |
| `!acelerar` | Acelerar vídeo/áudio em 2x |
| `!desacelerar` | Desacelerar vídeo/áudio em 0.5x |

### Downloads
| Comando | Descrição |
|---------|-----------|
| `!dl` / `!download` <link> | Baixar mídia de redes sociais |
| `!dhd` / `!downloadhd` <link> | Download em HD |
| `!play` <nome/link> | Baixar áudio do YouTube |

### IA
| Comando | Descrição |
|---------|-----------|
| `!ai` <pergunta> | Conversar com IA (OpenRouter) |
| `!resumir` | Resumir últimas mensagens do grupo |

### Privacidade
| Comando | Descrição |
|---------|-----------|
| `!revelar` / `!rv` | Revelar mídia de visualização única |

### Utilidades
| Comando | Descrição |
|---------|-----------|
| `!tts` <texto> | Texto para voz (Piper TTS) |
| `!traduzir` <texto> | Traduzir texto |
| `!perfil` | Ver foto de perfil |
| `!tutorial` | Guia rápido de comandos |

### Grupo & Config
| Comando | Descrição |
|---------|-----------|
| `!menu` | Menu completo de comandos |
| `!ativar` / `!desativar` | Ativar/desativar bot no grupo |
| `!config` | Ver configuração atual |
| `!set` <chave> <valor> | Alterar configuração |
| `!setprefix` <prefixo> | Mudar prefixo do bot |
| `!nome` <nome> | Alterar nome do bot no grupo |
| `!imagem` | Alterar imagem do menu do grupo |
| `!mencionar` | Marcar todos os membros |
| `!news` | Ativar feed de notícias Reddit |

### Administração
| Comando | Descrição |
|---------|-----------|
| `!ban` | Remover membro do grupo |
| `!mute` / `!desmute` | Silenciar/reativar membro |
| `!adv` | Dar advertência (3 = ban automático) |
| `!antilink` | Ativar proteção anti-link |
| `!dashboard` | Ativar logs do dashboard no grupo |
| `!dashlist` | Listar acessos ao dashboard |
| `!dashreset` | Resetar dashboard |
| `!grupos` | Listar grupos ativos |
| `!limpar` | Apagar últimas N mensagens |
| `!log` | Ver logs do terminal |
| `!divulgar` | Campanha de DM em massa |
| `!dump` | Backup .zip dos dados |
| `!restart` | Reiniciar o bot |
| `!update` | Atualizar via git pull |
| `!updateres` | Atualizar e reiniciar |

### Sub-Sessões
| Comando | Descrição |
|---------|-----------|
| `!login` / `!entrar` | Criar sub-sessão (QR Code) |
| `!logins` / `!sessoes` | Listar sub-sessões ativas |
| `!logoff` / `!sair` | Encerrar sub-sessão |
| `!subclean` | Limpar dados de sub-sessão |
| `!subcleanall` | Limpar TODAS sub-sessões |
| `!subdebug` | Diagnóstico de sub-sessões |

## 🖥️ Dashboard
Painel web em tempo real para monitorar mensagens, mídias e gerenciar o bot.

- Acesso: `http://<ip>:3000` (porta configurável)
- Autenticação com senha gerada automaticamente (veja no terminal ao iniciar)
- Logs em tempo real via WebSocket
- Visualizador de mídias (imagens, vídeos, áudios, figurinhas)
- Gerenciamento de grupos
- Estatísticas do sistema (CPU, RAM, uptime)
- Atualização do bot via botão (git pull + restart)

## ⚙️ Configuração
- Configure sua chave **OpenRouter** em `.env`: `OPENROUTER_API_KEY=sua_chave`
- Salve cookies do navegador como `cookies.txt` na raiz para mídias privadas do Instagram
- Use `!set` para ajustar modelo de IA, temperatura, cooldowns, qualidade de figurinhas, etc.
- O TTS usa modelo `pt_BR-cadu-medium` incluso em `models/tts/`

## 🧩 Config Keys Disponíveis
`botName`, `prefix`, `ownerNumber`, `ownerName`, `creatorName`, `aiModel`, `aiSystemPrompt`, `aiSummaryPrompt`, `aiTemperature`, `aiMaxTokens`, `aiCacheTtl`, `maxMediaDurationSeconds`, `muteTtl`, `antilinkAutoWarn`, `antilinkWarnLimit`, `dashboardPort`, `dashboardTheme`, `newsSubreddits`, `stickerAuthor`, `stickerPack`, `stickerQuality`, `reactError`, `reactSuccess`, `reactWait`, `reactProcessing`, entre outras.

---
Desenvolvido com 💜 por Christian Felipe.
