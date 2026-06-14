#!/bin/bash
if [ ! -d "node_modules" ]; then
  echo "📦 Instalando dependências (Isso pode demorar no Termux)..."
  # Remove lockfile para evitar conflitos de versão no registro npm
  rm -f package-lock.json
  # Tenta instalar as dependências. No Termux, erros no 'sharp' são comuns e serão ignorados.
  npm install --no-audit --no-fund || echo "⚠️ Alguns pacotes falharam, mas o bot tentará rodar com os essenciais."
fi
node index.js
