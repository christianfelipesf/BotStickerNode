#!/bin/bash
# init-letsencrypt.sh — para VPS Linux / Docker (Ubuntu/Debian)
# Uso: chmod +x nginx/init-letsencrypt.sh && ./nginx/init-letsencrypt.sh
# Domínio: botantigravity.duckdns.org  |  Email: troque abaixo

set -e

DOMAIN="botantigravity.duckdns.org"
EMAIL="seu@email.com"  # <-- TROQUE
STAGING=0  # 1 = teste (sem rate limit), 0 = produção

if [ "$EMAIL" = "seu@email.com" ]; then
  echo "⚠️  Edite EMAIL neste script antes de rodar!"
  exit 1
fi

echo "### Criando pastas certbot..."
mkdir -p certbot/conf certbot/www nginx/logs

echo "### Subindo nginx temporário para desafio ACME..."
docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d nginx
sleep 3

echo "### Emitindo cert para $DOMAIN ..."
docker compose -f docker-compose.yml -f docker-compose.nginx.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  --email "$EMAIL" --agree-tos --no-eff-email \
  $([ $STAGING -eq 1 ] && echo "--staging")

echo "### Reload nginx..."
docker exec nginx-duckdns nginx -s reload || docker compose -f docker-compose.yml -f docker-compose.nginx.yml restart nginx

echo "✅ Cert emitido. Teste: https://$DOMAIN"
echo "   Renovar: docker compose -f docker-compose.yml -f docker-compose.nginx.yml run --rm certbot renew && docker exec nginx-duckdns nginx -s reload"
# Cron sugerido (crontab -e):
# 0 3 * * * cd /caminho/do/BotStickerNode && docker compose -f docker-compose.yml -f docker-compose.nginx.yml run --rm certbot renew --quiet && docker exec nginx-duckdns nginx -s reload >/dev/null 2>&1
