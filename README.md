# BotStickerNode

Bot de WhatsApp para figurinhas, downloads e IA.

---

## 1. Instalação

```bash
git clone https://github.com/christianfelipesf/BotStickerNode
cd BotStickerNode
npm install
```

Crie o `.env` na raiz (se usar IA):

```
OPENROUTER_API_KEY=sua_chave_aqui
```

> Node >= 22 e FFmpeg são obrigatórios. No Ubuntu: `sudo apt install ffmpeg -y`

---

## 2. Rodar com PM2

Instale o PM2 global:

```bash
npm i -g pm2
```

Iniciar o bot:

```bash
pm2 start index.js --name bot
```

Outros comandos úteis:

```bash
pm2 logs bot        # ver logs / QR Code
pm2 restart bot     # reiniciar
pm2 stop bot        # parar
pm2 delete bot      # remover
pm2 save            # salvar para reiniciar sozinho após reboot
pm2 startup         # ativar início automático (rode o comando que ele gerar)
```

> Na primeira vez, veja o QR Code com `pm2 logs bot` e escaneie no WhatsApp > Aparelhos conectados.

Sem PM2 (teste rápido):

```bash
npm start
```

---

## 3. Ativar no Grupo

1. Adicione o número do bot no grupo
2. Promova o bot a **admin** (necessário para `!ban`, `!mute`, etc)
3. No grupo, envie:

```
!ativar
```

> Apenas o **dono do bot** pode ativar. Se der erro de permissão, configure o `ownerNumber` em `src/database/utils.js` ou via `!set ownerNumber 55...`

Para desativar:

```
!desativar
```

Para ver se está ativo:

```
!config
```

---

## Comandos principais

| Comando | O que faz |
|---|---|
| `!menu` | mostra todos os comandos |
| `!s` | cria figurinha (envie com imagem/vídeo) |
| `!toimg` | figurinha -> imagem |
| `!revelar` | revela visualização única |
| `!play <nome>` | baixa áudio do YouTube |
| `!dl <link>` | baixa TikTok/Insta/Face/YouTube |
| `!ai <pergunta>` | fala com IA |
| `!tts <texto>` | texto em áudio |
| `!ban` / `!mute` | moderação (marque a pessoa) |

Prefixo padrão é `!`. Troque com `!setprefix .`

---

## Dúvidas

- QR não aparece? `pm2 logs bot --lines 100` ou apague a pasta `session/` e reinicie.
- Bot não responde no grupo? Verifique se enviou `!ativar` e se o bot é admin.
