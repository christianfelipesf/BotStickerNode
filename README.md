# BotStickerNode 🌌
Um bot para WhatsApp potente com IA, bypass de visualização única e downloads de mídias sociais.

## 🚀 Funcionalidades Principais
- **Download de Mídias:** Baixe vídeos e fotos do TikTok, Instagram, YouTube, Facebook, Reddit e Google Imagens.
- **Inteligência Artificial:** Integrado com Google Gemini para conversas e resumos de chat.
- **Figurinhas:** Criação de figurinhas estáticas e animadas com metadados personalizados.
- **Conversão:** Converta figurinhas de volta para imagens/vídeos e vice-versa.
- **Privacidade:** Bypass automático de mensagens de visualização única (View Once).
- **TTS Offline:** Sintetizador de voz Piper integrado para mensagens de áudio realistas.

## 💻 Instalação (VPS Linux - Recomendado)
A melhor forma de rodar é via Docker para garantir que todas as dependências (FFmpeg, Python, yt-dlp) estejam corretas:

```bash
git clone https://github.com/christianfelipesf/BotStickerNode
cd BotStickerNode
docker-compose up -d
```

### Instalação Manual (Ubuntu/Debian)
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install nodejs ffmpeg python3 curl -y
# Instalar yt-dlp mais recente
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

npm install
node index.js
```

## 📱 Instalação (Termux)
```bash
pkg update && pkg upgrade
pkg install nodejs ffmpeg python3 curl libwebp libvips -y
# Instalar yt-dlp via pip para melhor compatibilidade
pip install yt-dlp

git clone https://github.com/christianfelipesf/BotStickerNode
cd BotStickerNode
npm install
node index.js
```

## 🤖 Comandos Principais
- `!menu` - Menu completo de comandos.
- `!dl` / `!social` / `!media` <link> - Baixa vídeos/fotos de redes sociais.
- `!play` <nome/link> - Baixa músicas do YouTube.
- `!s` - Cria figurinha (mande imagem/vídeo ou marque).
- `!revelar` - Revela mídia de visualização única (ou automático se ativado).
- `!ai` - Conversa com a IA Gemini.
- `!resumir` - Resumo sarcástico das últimas mensagens do grupo.

## ⚙️ Configuração
- Salve seus cookies do navegador como `cookies.txt` na raiz para baixar mídias privadas do Instagram.
- Use `!config` e `!set` para ajustar o nome do bot, prefixo e prompts da IA.

---
Desenvolvido com 💜 por Christian Felipe.
