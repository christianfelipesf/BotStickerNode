# Nginx + Certbot (manual) — botantigravity.duckdns.org

> Dashboard do bot roda em `127.0.0.1:3000`. O Nginx faz proxy para `https://botantigravity.duckdns.org` (sem `:3000`) com SSL Let's Encrypt.
> Pasta `nginx/` tem as configs; `scripts/setup-nginx-certbot.ps1` automatiza no Windows 10 sem WSL/Docker.

---

## 1) Pré-requisitos (igual ao tutorial.txt)

Já feito:
- DuckDNS `botantigravity.duckdns.org → 177.47.48.5` + updater a cada 5 min
- Dashboard `http://127.0.0.1:3000/api/health → 200`

Falta para HTTPS:
- **Roteador:** liberar **80 e 443** → `192.168.1.2` (hoje só 3000 está liberado). Sem 80 o Let's Encrypt não consegue validar.
  - `192.168.1.1` → Port Forwarding → `80 TCP → 192.168.1.2:80` + `443 TCP → 192.168.1.2:443`
- **DNS:** `nslookup botantigravity.duckdns.org 8.8.8.8` deve dar seu IP público (`curl https://api.ipify.org`)

---

## 2) Opção A — Windows nativo (seu caso: Win10 sem WSL/Docker) — RECOMENDADO

Usa **Nginx for Windows + win-acme** (Certbot para Windows). O script faz tudo.

### Passo a passo manual (sem script)
1. Baixe Nginx: https://nginx.org/en/download.html → `nginx-1.27.4.zip` → extraia para `C:\nginx`
2. Copie `nginx/nginx.windows.conf` → `C:\nginx\conf\nginx.conf` (sobrescreve)
3. Firewall (PowerShell **Admin**):
   ```powershell
   New-NetFirewallRule -DisplayName "Nginx 80 - botantigravity" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
   New-NetFirewallRule -DisplayName "Nginx 443 - botantigravity" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
   ```
4. Teste nginx:
   ```powershell
   C:\nginx\nginx.exe -t
   C:\nginx\nginx.exe       # inicia
   Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing # deve dar {"ok":true}
   ```
5. Baixe win-acme: https://www.win-acme.com/ → `win-acme.v2.x.x.x64.pluggable.zip` → extraia em `C:\win-acme`
6. Garanta que `C:\nginx\html\.well-known\acme-challenge\` existe e que `http://botantigravity.duckdns.org/.well-known/acme-challenge/test` é acessível de fora (porta 80 liberada).
7. Emita cert:
   ```powershell
   C:\win-acme\wacs.exe --source manual --host botantigravity.duckdns.org --webroot C:\nginx\html --emailaddress seu@email.com --accepttos
   ```
   - Escolha **N** quando perguntar sobre IIS. Anote onde salvou o `.pem` (ex `C:\ProgramData\win-acme\...` ou `C:\nginx\certs\`).
8. Ajuste `C:\nginx\conf\nginx.conf` → `ssl_certificate` / `ssl_certificate_key` para o caminho real do cert. Reload:
   ```powershell
   C:\nginx\nginx.exe -t
   C:\nginx\nginx.exe -s reload
   ```
9. Teste: `https://botantigravity.duckdns.org` (sem `:3000`). Se abrir, OK. Renovar: win-acme já cria tarefa agendada; verifique com `Get-ScheduledTask *win-acme*`.

### Automático com script
```powershell
# PowerShell Admin, na pasta do bot:
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\setup-nginx-certbot.ps1 -Email "seu@gmail.com"
# com certbot em vez de win-acme:
.\scripts\setup-nginx-certbot.ps1 -Email "seu@gmail.com" -UseCertbot
```

---

## 3) Opção B — Docker (se instalar Docker Desktop ou migrar para VPS Linux)

Pré-requisito: Docker + Docker Compose instalados. Portas 80/443 livres.

```powershell
# 1. Ajuste o conf para Docker (troque upstream)
# Em nginx/botantigravity.duckdns.org.conf, descomente: server whatsapp-bot:3000; e comente 127.0.0.1:3000

# 2. Suba o stack
docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d

# 3. Emita cert (troque email)
docker compose -f docker-compose.yml -f docker-compose.nginx.yml run --rm certbot certonly --webroot -w /var/www/certbot -d botantigravity.duckdns.org --email seu@email.com --agree-tos --no-eff-email

# 4. Reload
docker exec nginx-duckdns nginx -s reload

# 5. Teste
curl -k https://botantigravity.duckdns.org/api/health
```

Renovação (cron no host ou Task Scheduler no Windows):
```bash
docker compose -f docker-compose.yml -f docker-compose.nginx.yml run --rm certbot renew --quiet && docker exec nginx-duckdns nginx -s reload
```

Para VPS Linux puro (sem Docker), use:
```bash
chmod +x nginx/init-letsencrypt.sh
# edite EMAIL dentro do script
./nginx/init-letsencrypt.sh
```

---

## 4) Express trust proxy

`src/dashboard/dashboard.js:334` já tem `app.set('trust proxy', 1)` — necessário para `X-Forwarded-For` e rate-limit funcionarem atrás do Nginx. Não precisa mudar.

`src/database/utils.js:205` já está `dashboardUrl: "https://botantigravity.duckdns.org"` — correto para Nginx (sem porta). Se ainda estiver com `:3000`, mude no painel admin (`/admin`) ou no DB.

---

## 5) Troubleshooting

| Sintoma | Causa / Solução |
|---|---|
| `Timeout` em `http://botantigravity.duckdns.org` | Firewall/roteador não liberou 80/443. Teste `http://192.168.1.2:80` na mesma rede. |
| `Failed authorization` (Let's Encrypt) | DNS ainda aponta IP antigo. `nslookup botantigravity.duckdns.org 8.8.8.8` deve dar seu IP. Force update: `https://www.duckdns.org/update?domains=botantigravity&token=SEU_TOKEN&ip=` |
| `502 Bad Gateway` no Nginx | Dashboard fora do ar. `netstat -ano | findstr :3000` deve mostrar LISTEN. `npm start` |
| `SSL_ERROR` / cert não encontrado | Caminho `ssl_certificate` errado. `C:\nginx\nginx.exe -t` mostra erro. Ajuste para onde win-acme/certbot salvou. |
| WebSocket/Socket.IO não conecta | Faltou `Upgrade`/`Connection` no proxy. Use os `location /socket.io/` do exemplo. |
| CGNAT (`100.64.x.x` na WAN do roteador) | Port forward não funciona. Use **Cloudflare Tunnel** ou Tailscale Funnel em vez de DuckDNS direto. |

Comandos úteis:
```powershell
C:\nginx\nginx.exe -t            # testa conf
C:\nginx\nginx.exe -s reload     # recarrega
C:\nginx\nginx.exe -s stop
Get-NetFirewallRule -DisplayName "Nginx*"
nslookup botantigravity.duckdns.org 8.8.8.8
Invoke-WebRequest https://botantigravity.duckdns.org/api/health -UseBasicParsing
Get-ScheduledTask *win-acme* | Get-ScheduledTaskInfo
Get-ScheduledTask *Certbot* | Get-ScheduledTaskInfo
```

---

## Arquivos neste repo

- `nginx/botantigravity.duckdns.org.conf` — vhost para Linux/Docker (`/etc/nginx/conf.d/`)
- `nginx/nginx.windows.conf` — `nginx.conf` completo para `C:\nginx\conf\nginx.conf`
- `nginx/init-letsencrypt.sh` — emissor para VPS Linux/Docker
- `docker-compose.nginx.yml` — overlay com `nginx` + `certbot` (use `-f` duplo)
- `scripts/setup-nginx-certbot.ps1` — instalador Windows Admin (Nginx + win-acme/certbot + firewall + tasks)
