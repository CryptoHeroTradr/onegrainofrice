#!/usr/bin/env bash
#
# STEP 1 of 2 — put the $RICE site on 1grainofrice.com with its own HTTPS cert.
#
# This is the minimal, low-risk fix for "my domain shows CXMZ / has no cert".
# It ONLY adds a name-based vhost for 1grainofrice.com (+ www) and issues a
# certificate. It does NOT touch the bare IP, CXMZ, RiceDAO, or the ip-rice
# default server — so nothing else changes and there's no game-subdomain
# dependency. Blanking the IP + moving RiceDAO to its subdomain is STEP 2
# (deploy/apply-domain.sh), run later once game.1grainofrice.com DNS exists.
#
# Run with root:  sudo bash deploy/step1-rice-domain.sh
# Idempotent: safe to re-run.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IP=209.141.52.60
EMAIL="cryptoherotrader@gmail.com"
SA=/etc/nginx/sites-available
SE=/etc/nginx/sites-enabled

if [[ $EUID -ne 0 ]]; then echo "ERROR: run with sudo." >&2; exit 1; fi

echo "==> DNS preflight (apex + www)"
for name in 1grainofrice.com www.1grainofrice.com; do
  got="$(getent hosts "$name" | awk '{print $1}' | head -1 || true)"
  [[ "$got" == "$IP" ]] || { echo "ERROR: $name -> '${got:-nothing}', expected $IP." >&2; exit 1; }
  echo "    $name -> $got  OK"
done

echo "==> Installing sites-available/1grainofrice (name-based vhost)"
cp "$REPO/deploy/nginx-1grainofrice.com" "$SA/1grainofrice"
ln -sfn "$SA/1grainofrice" "$SE/1grainofrice"

echo "==> Validating + reloading nginx"
nginx -t
systemctl reload nginx

echo "==> certbot: 1grainofrice.com + www (adds 443 + HTTP->HTTPS redirect)"
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" --redirect \
  -d 1grainofrice.com -d www.1grainofrice.com

echo "==> Final validate + reload"
nginx -t && systemctl reload nginx

cat <<'EOF'

STEP 1 DONE.
  https://1grainofrice.com  -> $RICE site at root, valid cert
  http://1grainofrice.com   -> 301 redirect to https

Still unchanged until STEP 2 (deploy/apply-domain.sh, needs game DNS):
  - http(s)://209.141.52.60 still serves CXMZ (IP not blanked yet)
  - RiceDAO still at 209.141.52.60/RiceDAO/

Verify:
  curl -sI https://1grainofrice.com/ | head -1     # HTTP/2 200
  curl -sI http://1grainofrice.com/  | head -1     # 301
EOF
