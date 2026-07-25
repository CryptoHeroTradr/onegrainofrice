#!/usr/bin/env bash
#
# One-time setup for GeoIP2 country lookups used by the grains leaderboard.
# Installs the geoipupdate client + the nginx GeoIP2 module, fetches the
# GeoLite2-Country database, and enables a weekly refresh timer.
#
# Requires root (run with sudo). Idempotent-ish: safe to re-run. This does NOT
# contain any secret — you must create /etc/GeoIP.conf with your MaxMind
# AccountID + LicenseKey first (see GeoIP.conf.example).
#
#   sudo bash deploy/geoip/install-geoipupdate.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEOIP_DIR="${REPO_DIR}/deploy/geoip"

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (sudo)." >&2
  exit 1
fi

echo "==> Installing geoipupdate + nginx GeoIP2 module (apt)…"
apt-get update -y
# geoipupdate      = MaxMind DB downloader (provides /usr/bin/geoipupdate)
# libnginx-mod-http-geoip2 = the ngx_http_geoip2_module (mmdb-based) nginx needs.
#   (The stock nginx here ships only the LEGACY geoip module, which is NOT
#    compatible with .mmdb files — this package adds the geoip2 module and
#    auto-enables it via /etc/nginx/modules-enabled/.)
# --force-confold + noninteractive: if /etc/GeoIP.conf already exists, keep it
# (never clobber our real creds with the package's empty default, and no prompt).
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  -o Dpkg::Options::="--force-confold" -o Dpkg::Options::="--force-confdef" \
  geoipupdate libnginx-mod-http-geoip2

echo "==> Ensuring /etc/GeoIP.conf has real credentials…"
# Prefer the filled, gitignored local config if present; place it AFTER apt so a
# package-shipped default can never overwrite it.
if [[ -f "${GEOIP_DIR}/GeoIP.conf.local" ]]; then
  cp "${GEOIP_DIR}/GeoIP.conf.local" /etc/GeoIP.conf
fi
if [[ ! -f /etc/GeoIP.conf ]] || grep -qE '^\s*(AccountID[[:space:]]+0|LicenseKey[[:space:]]+0+)\s*$' /etc/GeoIP.conf; then
  echo "ERROR: /etc/GeoIP.conf is missing or still has placeholder credentials." >&2
  echo "       Create ${GEOIP_DIR}/GeoIP.conf.local (real AccountID + LicenseKey)" >&2
  echo "       or edit /etc/GeoIP.conf directly, then re-run." >&2
  exit 1
fi
chmod 600 /etc/GeoIP.conf

echo "==> Ensuring database directory exists…"
install -d -m 0755 /usr/share/GeoIP

echo "==> Fetching GeoLite2-Country.mmdb (first run)…"
geoipupdate -v

echo "==> Installing weekly refresh timer…"
cp "${GEOIP_DIR}/geoipupdate.service" /etc/systemd/system/geoipupdate.service
cp "${GEOIP_DIR}/geoipupdate.timer"   /etc/systemd/system/geoipupdate.timer
systemctl daemon-reload
systemctl enable --now geoipupdate.timer

echo "==> Done. Verify:"
echo "    ls -l /usr/share/GeoIP/GeoLite2-Country.mmdb"
echo "    systemctl list-timers geoipupdate.timer"
echo
echo "Next: install deploy/nginx-geoip2.conf to /etc/nginx/conf.d/ and update the"
echo "onegrainofrice server block (see docs/grains/DEPLOY.md), then: nginx -t && reload."
