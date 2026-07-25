#!/usr/bin/env bash
#
# Wire the grains edge into the live nginx server block (needs root).
#   1) installs deploy/nginx-geoip2.conf → /etc/nginx/conf.d/geoip2.conf
#   2) replaces the single `location ^~ /onegrainofrice { … }` block in the
#      ip-rice server with the app + WS blocks from
#      deploy/nginx-onegrainofrice.location (country headers + /grains/ws proxy)
#   3) validates with `nginx -t` and reloads — restoring the backup on failure.
#
# Run the geoip installer FIRST (deploy/geoip/install-geoipupdate.sh), otherwise
# `nginx -t` fails on the unknown `geoip2` directive / missing .mmdb and this
# script rolls back. Idempotent: re-running after success is a no-op.
#
#   sudo bash deploy/geoip/../apply-nginx.sh      # i.e. sudo bash deploy/apply-nginx.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE=/etc/nginx/sites-available/ip-rice
GEOIP2_SRC="$REPO/deploy/nginx-geoip2.conf"
NEWBLOCK="$REPO/deploy/nginx-onegrainofrice.location"

if [[ $EUID -ne 0 ]]; then echo "ERROR: run with sudo." >&2; exit 1; fi
for f in "$SITE" "$GEOIP2_SRC" "$NEWBLOCK"; do
  [[ -f "$f" ]] || { echo "ERROR: missing $f" >&2; exit 1; }
done

# Idempotency: if the WS block is already present, we've applied this before.
if grep -q 'location \^~ /onegrainofrice/grains/ws' "$SITE"; then
  echo "Already applied (WS location present). Ensuring geoip2 conf + reload."
  cp "$GEOIP2_SRC" /etc/nginx/conf.d/geoip2.conf
  nginx -t && systemctl reload nginx && echo "OK." || { echo "nginx -t failed."; exit 1; }
  exit 0
fi

echo "==> Installing geoip2 http block → /etc/nginx/conf.d/geoip2.conf"
cp "$GEOIP2_SRC" /etc/nginx/conf.d/geoip2.conf

BACKUP="$SITE.bak.$(date +%s)"
echo "==> Backing up $SITE → $BACKUP"
cp "$SITE" "$BACKUP"

echo "==> Swapping the /onegrainofrice location block"
awk -v newfile="$NEWBLOCK" '
  BEGIN { while ((getline line < newfile) > 0) newblk = newblk line "\n" }
  # Drop the existing single `location ^~ /onegrainofrice {` block (no nested
  # braces inside it, so the first "}" at any indent closes it).
  /^[[:space:]]*location \^~ \/onegrainofrice \{/ { skip=1 }
  skip { if ($0 ~ /^[[:space:]]*\}/) skip=0; next }
  { print }
  # Insert the new app + WS blocks right after server_name.
  /server_name 209\.141\.52\.60 _;/ { printf "%s", newblk }
' "$SITE" > "$SITE.tmp"
mv "$SITE.tmp" "$SITE"

echo "==> Validating (nginx -t)"
if nginx -t; then
  systemctl reload nginx
  echo "OK: nginx reloaded. The grains WS proxy + GeoIP2 headers are live."
else
  echo "nginx -t FAILED — restoring backup and removing geoip2 conf." >&2
  cp "$BACKUP" "$SITE"
  rm -f /etc/nginx/conf.d/geoip2.conf
  echo "Restored. (Did you run deploy/geoip/install-geoipupdate.sh first?)" >&2
  exit 1
fi
