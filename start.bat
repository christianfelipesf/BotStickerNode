@echo off
if not exist node_modules (
    echo 📦 Instalando dependencias...
    npm install
)
node index.js
pause
