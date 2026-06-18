#!/bin/bash

set -e

echo "==============================="
echo "      Atualizador do Bot"
echo "==============================="
echo
echo "1) Atualizar código e reiniciar PM2"
echo "2) Atualizar código, executar npm install e reiniciar PM2"
echo "3) Parar todos os processos PM2"
echo
read -p "Escolha uma opção [1-3]: " opcao

echo
read -p "Tem certeza? [s/N]: " confirmar

case "$confirmar" in
s|S|sim|SIM)
;;
*)
echo "❌ Operação cancelada."
exit 0
;;
esac

echo

case "$opcao" in
1)
echo "📥 Atualizando repositório..."
git fetch --all
git reset --hard origin/main
git clean -fd

```
    echo "🔄 Reiniciando PM2..."
    pm2 restart all

    echo "✅ Atualização concluída!"
    ;;

2)
    echo "📥 Atualizando repositório..."
    git fetch --all
    git reset --hard origin/main
    git clean -fd

    echo "📦 Instalando dependências..."
    npm install

    echo "🔄 Reiniciando PM2..."
    pm2 restart all

    echo "✅ Atualização concluída!"
    ;;

3)
    echo "🛑 Parando todos os processos PM2..."
    pm2 stop all
    echo "✅ Todos os processos foram parados."
    ;;

*)
    echo "❌ Opção inválida."
    exit 1
    ;;
```

esac
