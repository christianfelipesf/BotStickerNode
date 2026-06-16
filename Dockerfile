# Utilizando a versão do Node recomendada no seu package.json (>=22.14.0)
FROM node:22.14-alpine

# Instala FFmpeg, python3 (requisito do yt-dlp) e ferramentas de compilação
RUN apk add --no-cache ffmpeg python3 curl make g++

# Baixa e instala a versão mais recente do yt-dlp diretamente no sistema do container
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Define o diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copia os arquivos de dependências
COPY package*.json ./

# Instala as dependências do projeto
RUN npm install --omit=dev

# Copia o restante dos arquivos do projeto
COPY . .

# Comando para iniciar o bot
CMD [ "npm", "start" ]