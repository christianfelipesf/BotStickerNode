#!/bin/bash
# Script de configuração automática para Termux

echo "📱 Iniciando configuração para Termux..."

# Atualizar pacotes
echo "📦 Atualizando pacotes do sistema..."
pkg update && pkg upgrade -y

# Instalar dependências básicas
echo "📥 Instalando Node.js, FFmpeg, Git e Python..."
pkg install nodejs git ffmpeg python python-pip make clang pkg-config libvips -y

# Instalar yt-dlp via pip
echo "🎵 Instalando yt-dlp..."
pip install yt-dlp

# Instalar dependências do bot
echo "📦 Instalando dependências do Node.js..."
npm install

echo "✅ Configuração concluída!"
echo "🚀 Use './start.sh' para iniciar o bot."
chmod +x start.sh
