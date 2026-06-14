# BotStickerNode 🌌
Um bot para WhatsApp com recursos de IA, revelação de mídia única e criação de figurinhas.

## 🚀 Instalação (Termux)
Para rodar no Termux, siga estes passos para garantir que as dependências do sistema estejam instaladas:

```bash
pkg update && pkg upgrade
pkg install nodejs ffmpeg yt-dlp libwebp libvips -y
git clone https://github.com/christianfelipesf/BotStickerNode
cd BotStickerNode
npm install
node index.js
```

> **Nota:** O bot utiliza `jimp` e `node-webpmux` para geração de figurinhas com metadados, garantindo alta compatibilidade e performance mesmo em ambientes limitados como o Termux.

## 💻 Instalação (Windows/Linux)
1. Instale o Node.js.
2. Instale o FFmpeg e adicione ao PATH.
3. Clone o repositório.
4. Execute `npm install`.
5. Execute `node index.js`.

## 🤖 Comandos
- `!menu` - Exibe o menu de comandos.
- `!s` - Cria uma figurinha a partir de imagem/vídeo.
- `!toimg` - Converte figurinha para imagem/vídeo.
- `!r` ou `!revelar` - Revela mídias de visualização única.
- `!ai` - Conversa com a IA (Gemini).
- `!play` - Baixa e envia música do YouTube.
- `!ativar` / `!desativar` - Ativa/Desativa o bot no grupo.
