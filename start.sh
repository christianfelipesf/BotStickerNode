#!/bin/bash
if [ ! -d "node_modules" ]; then
  echo "📦 Instalando dependências..."
  npm install
fi
node index.js
