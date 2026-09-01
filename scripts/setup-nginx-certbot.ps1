#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Setup Nginx + Certbot/Win-ACME para botantigravity.duckdns.org no Windows 10 (sem WSL/Docker)
  Faz: baixa nginx, cria conf, libera firewall, emite certificado com win-acme OU certbot, instala task de renovação.
  Domínio: botantigravity.duckdns.org  -> proxy para 127.0.0.1:3000 (dashboard)

.OPÇÕES
  -UseCertbot   : usa Certbot (pip) em vez de win-acme (padrão é win-acme, mais simples no Windows)
  -Email seu@email.com : email para Let's Encrypt (obrigatório)
  -NginxPath C:\nginx  : onde instalar nginx

.EXEMPLO
  .\setup-nginx-certbot.ps1 -Email "seu@email.com"
  .\setup-nginx-certbot.ps1 -UseCertbot -Email "seu@email.com"
#>
param(
    [string]$Domain = "botantigravity.duckdns.org",
    [string]$Email = "",
    [string]$NginxPath = "C:\nginx",
    [switch]$UseCertbot
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) { throw "Rode este script como Administrador (PowerShell Admin)." }
}
function Test-PortForward {
    Write-Host "`n[CHECK] Verificando se porta 80/443 está acessível externamente..." -ForegroundColor Cyan
    try {
        $pubIp = (Invoke-RestMethod https://api.ipify.org -TimeoutSec 5).Trim()
        Write-Host "  IP público atual: $pubIp"
        Write-Host "  DuckDNS deve apontar para este IP. Verifique: nslookup $Domain 8.8.8.8" -ForegroundColor Yellow
        $dns = (Resolve-DnsName $Domain -Server 8.8.8.8 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress }).IPAddress
        if ($dns) { Write-Host "  DNS atual: $dns" }
        if ($dns -ne $pubIp) { Write-Host "  ⚠️  DNS != IP público! Rode antes: https://www.duckdns.org/update?domains=botantigravity&token=SEU_TOKEN&ip=" -ForegroundColor Red }
    } catch { Write-Host "  (não foi possível checar IP/DNS): $_" -ForegroundColor Yellow }
}

Assert-Admin
if (-not $Email -or $Email -notmatch "@") {
    Write-Host "Informe -Email válido. Ex: .\setup-nginx-certbot.ps1 -Email seu@gmail.com" -ForegroundColor Red
    exit 1
}

Test-PortForward

# 1. Firewall — liberar 80/443 (e manter 3000 se já existe)
Write-Host "`n[1/6] Liberando firewall 80/443..." -ForegroundColor Cyan
foreach ($p in @(80,443)) {
    $rule = "Nginx $p - $Domain"
    if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rule -Direction Inbound -LocalPort $p -Protocol TCP -Action Allow | Out-Null
        Write-Host "  + $rule"
    } else { Write-Host "  = $rule já existe" }
}
# 3000 já deve existir do tutorial; garante
if (-not (Get-NetFirewallRule -DisplayName "WhatsApp Dashboard 3000" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "WhatsApp Dashboard 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow | Out-Null
}

# 2. Baixar Nginx for Windows se não existe
Write-Host "`n[2/6] Nginx..." -ForegroundColor Cyan
if (-not (Test-Path "$NginxPath\nginx.exe")) {
    $tmp = "$env:TEMP\nginx.zip"
    $url = "https://nginx.org/download/nginx-1.27.4.zip"
    Write-Host "  Baixando $url -> $tmp"
    Invoke-WebRequest $url -OutFile $tmp
    Expand-Archive $tmp -DestinationPath $env:TEMP -Force
    $extracted = Get-ChildItem "$env:TEMP\nginx-*" -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not (Test-Path $NginxPath)) { New-Item -ItemType Directory -Path $NginxPath | Out-Null }
    Copy-Item "$($extracted.FullName)\*" $NginxPath -Recurse -Force
    Write-Host "  Nginx instalado em $NginxPath"
} else { Write-Host "  Nginx já em $NginxPath" }

# 3. Copiar nginx.conf
Write-Host "`n[3/6] Configurando nginx.conf..." -ForegroundColor Cyan
$srcConf = Join-Path $PSScriptRoot "..\nginx\nginx.windows.conf"
if (-not (Test-Path $srcConf)) { $srcConf = "C:\Users\Santa Rita\Documents\BotStickerNode\nginx\nginx.windows.conf" }
if (Test-Path $srcConf) {
    Copy-Item $srcConf "$NginxPath\conf\nginx.conf" -Force
    Write-Host "  Copiado $srcConf -> $NginxPath\conf\nginx.conf"
    # Cria pastas necessárias
    New-Item -ItemType Directory -Path "$NginxPath\html\.well-known\acme-challenge" -Force | Out-Null
    New-Item -ItemType Directory -Path "$NginxPath\certs" -Force | Out-Null
    New-Item -ItemType Directory -Path "C:\Certbot\live\$Domain" -Force | Out-Null
} else { Write-Host "  ⚠️  $srcConf não encontrado — copie manualmente nginx/nginx.windows.conf para $NginxPath\conf\nginx.conf" -ForegroundColor Yellow }

# 4. Testar nginx e iniciar
Write-Host "`n[4/6] Testando nginx..." -ForegroundColor Cyan
Push-Location $NginxPath
try { & .\nginx.exe -t; if ($LASTEXITCODE -ne 0) { throw "nginx -t falhou" } } catch { Write-Host "  Erro nginx -t: $_" -ForegroundColor Yellow }
# se já rodando, reload; senão start
$proc = Get-Process nginx -ErrorAction SilentlyContinue
if ($proc) { & .\nginx.exe -s reload; Write-Host "  nginx reload" } else { Start-Process .\nginx.exe; Start-Sleep 2; Write-Host "  nginx iniciado" }
Pop-Location
Write-Host "  Teste local: http://127.0.0.1:80  e https://127.0.0.1:443 (443 falha até ter cert)"
try { Invoke-WebRequest http://127.0.0.1:3000/api/health -UseBasicParsing -TimeoutSec 5 | Out-Null; Write-Host "  Dashboard 3000 OK" -ForegroundColor Green } catch { Write-Host "  ⚠️  Dashboard não responde em 127.0.0.1:3000 — inicie o bot (npm start)" -ForegroundColor Red }

# 5. Emitir certificado
Write-Host "`n[5/6] Emitindo certificado Let's Encrypt para $Domain..." -ForegroundColor Cyan
Write-Host "  IMPORTANTE: porta 80 deve estar redirecionada no roteador (80 -> 192.168.1.2:80) e DNS apontando para seu IP público." -ForegroundColor Yellow

if ($UseCertbot) {
    # Certbot via pip
    Write-Host "  Usando Certbot (pip)..."
    if (-not (Get-Command certbot -ErrorAction SilentlyContinue)) {
        Write-Host "  Instalando certbot via pip..."
        python -m pip install certbot --quiet
    }
    # Para Windows, certbot certonly --standalone precisa que nginx esteja parado na 80
    Write-Host "  Parando nginx temporariamente para standalone..."
    Push-Location $NginxPath; & .\nginx.exe -s stop; Start-Sleep 2; Pop-Location
    certbot certonly --standalone -d $Domain --email $Email --agree-tos --no-eff-email --non-interactive
    $certPath = "C:\Certbot\live\$Domain\fullchain.pem"
    if (Test-Path $certPath) {
        Write-Host "  Cert emitido: $certPath" -ForegroundColor Green
        # Copia certs para onde nginx espera (opcional, se nginx.conf aponta para C:/Certbot/ já ok)
    } else { Write-Host "  ⚠️  Cert não gerado. Veja logs do certbot." -ForegroundColor Red }
    Push-Location $NginxPath; Start-Process .\nginx.exe; Pop-Location
    # Task renovação
    $action = New-ScheduledTaskAction -Execute "certbot" -Argument "renew --quiet"
    $trigger = New-ScheduledTaskTrigger -Daily -At 3am
    Register-ScheduledTask -TaskName "Certbot-Renew-$Domain" -Action $action -Trigger $trigger -Description "Renova cert $Domain" -Force | Out-Null
    Write-Host "  Tarefa agendada: Certbot-Renew-$Domain (diária 03:00)"
} else {
    # win-acme (recomendado)
    $wacsPath = "C:\win-acme\wacs.exe"
    if (-not (Test-Path $wacsPath)) {
        $tmp2 = "$env:TEMP\win-acme.zip"
        $url2 = "https://github.com/win-acme/win-acme/releases/latest/download/win-acme.v2.2.9.1701.x64.pluggable.zip"
        # fallback: pega latest via redirect
        Write-Host "  Baixando win-acme..."
        try { Invoke-WebRequest $url2 -OutFile $tmp2 } catch {
            $url2 = "https://github.com/win-acme/win-acme/releases/download/v2.2.9.1701/win-acme.v2.2.9.1701.x64.pluggable.zip"
            Invoke-WebRequest $url2 -OutFile $tmp2
        }
        New-Item -ItemType Directory -Path "C:\win-acme" -Force | Out-Null
        Expand-Archive $tmp2 -DestinationPath "C:\win-acme" -Force
        Write-Host "  win-acme em C:\win-acme"
    }
    Write-Host "`n  Rode manualmente (interativo) — escolha N, depois aponte para C:\nginx\html:" -ForegroundColor Yellow
    Write-Host "  C:\win-acme\wacs.exe --source manual --host $Domain --webroot C:\nginx\html --emailaddress $Email --accepttos" -ForegroundColor White
    Write-Host "  Ou execute agora (tentativa automática):" -ForegroundColor Cyan
    $ans = Read-Host "  Emitir agora? (s/n)"
    if ($ans -match "^s") {
        & "C:\win-acme\wacs.exe" --source manual --host $Domain --webroot "$NginxPath\html" --emailaddress $Email --accepttos --verbose
        # win-acme já cria task de renovação automaticamente
        Write-Host "  Se wacs pediu para instalar cert no IIS, escolha 'No' e anote o caminho do .pem/.pfx" -ForegroundColor Yellow
        Write-Host "  Depois ajuste ssl_certificate em $NginxPath\conf\nginx.conf para o caminho exportado e rode: nginx -s reload" -ForegroundColor Yellow
    } else {
        Write-Host "  Pulei emissão. Rode o comando acima quando liberar porta 80 no roteador." -ForegroundColor Yellow
    }
}

# 6. Verificação final
Write-Host "`n[6/6] Verificação..." -ForegroundColor Cyan
Push-Location $NginxPath; & .\nginx.exe -t; Pop-Location
Write-Host "`n=== PRÓXIMOS PASSOS MANUAIS ===" -ForegroundColor Green
Write-Host "1. Roteador: libere 80 e 443 -> 192.168.1.2 (além do 3000 já feito). Sem isso Let's Encrypt falha."
Write-Host "2. Se usou win-acme, ajuste ssl_certificate no nginx.conf para o caminho que o wacs mostrou e rode: C:\nginx\nginx.exe -s reload"
Write-Host "3. Teste: https://$Domain  (deve abrir dashboard sem :3000)"
Write-Host "4. No bot, dashboardUrl já está https://$Domain (src/database/utils.js:205) — sem :3000"
Write-Host "5. Renovação: win-acme já agenda; certbot agenda task diária 03:00. Verifique: Get-ScheduledTask *Renew* | Get-ScheduledTaskInfo"
Write-Host "`nLogs: $NginxPath\logs\error.log  |  Dashboard: http://127.0.0.1:3000/api/health"
