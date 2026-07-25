#!/usr/bin/env bash
#
# Cut the VPS over to name-based hosting:
#   1grainofrice.com / www  -> $RICE app at root      (:3006 + grains WS :3007)
#   game.1grainofrice.com   -> RiceDAO                (:1111 web, :1112 api)
#   cxmz.io                 -> CXMZ                    (unchanged, its own vhost)
#   bare IP / unknown host  -> NOTHING (444 / rejected TLS)
#
# Retires the old ip-rice IP-path gateway entirely. CXMZ already lives on
# cxmz.io and RiceDAO moves to game.1grainofrice.com, so the IP no longer needs
# to serve anything.
#
# Run with root:  sudo bash deploy/apply-domain.sh
# Idempotent: safe to re-run.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IP=209.141.52.60
EMAIL="cryptoherotrader@gmail.com"
SA=/etc/nginx/sites-available
SE=/etc/nginx/sites-enabled

if [[ $EUID -ne 0 ]]; then echo "ERROR: run with sudo." >&2; exit 1; fi

# --- Preflight: every name must already resolve to this VPS on PUBLIC DNS, or
#     certbot's HTTP-01 fails. We query DNS-over-HTTPS (Cloudflare) rather than
#     the local resolver, which can lag behind with a cached NXDOMAIN for a
#     freshly-added record even though the world already sees it. Refuse to
#     proceed otherwise, so RiceDAO isn't taken off the IP before its subdomain
#     works.
echo "==> DNS preflight (via public DoH resolver)"
for name in 1grainofrice.com www.1grainofrice.com game.1grainofrice.com; do
  ans="$(curl -s -H 'accept: application/dns-json' \
    "https://1.1.1.1/dns-query?name=${name}&type=A" 2>/dev/null || true)"
  if ! grep -q "\"data\":\"$IP\"" <<<"$ans"; then
    echo "ERROR: $name does not resolve to $IP on public DNS yet." >&2
    echo "       Answer was: ${ans:-<no response>}" >&2
    echo "       Add/await the DNS A record, then re-run." >&2
    exit 1
  fi
  echo "    $name -> $IP  OK"
done

# --- Install the three vhosts + the blackhole default server.
echo "==> Installing vhosts"
cp "$REPO/deploy/nginx-00-blackhole.conf"       "$SA/00-blackhole"
cp "$REPO/deploy/nginx-1grainofrice.com"        "$SA/1grainofrice"
cp "$REPO/deploy/nginx-game.1grainofrice.com"   "$SA/game.1grainofrice.com"
ln -sfn "$SA/00-blackhole"                      "$SE/00-blackhole"
ln -sfn "$SA/1grainofrice"                      "$SE/1grainofrice"
ln -sfn "$SA/game.1grainofrice.com"             "$SE/game.1grainofrice.com"

# --- Retire the old IP-path gateway (the thing that redirected the IP to
#     /CXMZ/ and path-hosted every app). Reversible: re-link it to restore.
echo "==> Retiring ip-rice (removing sites-enabled symlink)"
rm -f "$SE/ip-rice"

echo "==> Validating nginx config"
nginx -t
echo "==> Reloading nginx"
systemctl reload nginx

# --- TLS. cxmz.io already has its cert; issue for the two new hostnames.
echo "==> certbot: 1grainofrice.com + www"
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" --redirect \
  -d 1grainofrice.com -d www.1grainofrice.com

echo "==> certbot: game.1grainofrice.com"
certbot --nginx --non-interactive --agree-tos -m "$EMAIL" --redirect \
  -d game.1grainofrice.com

echo "==> Final validate + reload"
nginx -t && systemctl reload nginx

cat <<'EOF'

DONE.
  https://1grainofrice.com        -> $RICE site at root
  https://game.1grainofrice.com   -> RiceDAO
  http://209.141.52.60            -> nothing (connection closed)

Verify:
  curl -sI https://1grainofrice.com/      | head -1     # 200
  curl -sI https://game.1grainofrice.com/ | head -1     # 302 -> /RiceDAO/
  curl -s  -o /dev/null -w '%{http_code}\n' http://209.141.52.60/   # 000/444 (closed)
EOF
