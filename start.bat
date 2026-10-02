@echo off
REM ============================================================
REM  BotStickerNode - comandos rapidos (guia, nao executam)
REM ============================================================
REM  --- PM2 ---
REM  Subir no PM2:        pm2 start index.js --name botsticker
REM  Ver status:          pm2 list
REM  Ver logs:            pm2 logs botsticker
REM  Reiniciar PM2:       pm2 restart botsticker
REM  Reiniciar todos:     pm2 restart all
REM  Parar PM2:           pm2 stop botsticker
REM  Parar todos:         pm2 stop all
REM  Remover do PM2:      pm2 delete botsticker
REM  Salvar lista PM2:    pm2 save
REM
REM  --- GitHub: sincronizar / puxar da nuvem ---
REM  Puxar da nuvem:      git pull
REM  Ver situacao:        git status
REM  Enviar p/ nuvem:     git add -A ^&^& git commit -m "update" ^&^& git push
REM ============================================================
npm start
pause
