# Grains — production deploy (edge, GeoIP2, WS, pm2)

Runbook for shipping the grains game on the VPS (`209.141.52.60`, nginx `:80`
default server `ip-rice`, app under basePath `/onegrainofrice`). Covers GeoIP2
country attribution, the WebSocket proxy, keeping the geo DB fresh, and pm2.

> **Privileged steps need root.** The deploy user has **no passwordless sudo**,
> so every `sudo …` line below must be run by an operator who has it. Nothing
> here commits a secret or the `.mmdb`.

## Topology

```
client ──:80──▶ nginx (ip-rice, edge, GeoIP2)
                 ├─ ^~ /onegrainofrice/grains/ws ─▶ 127.0.0.1:3007  (oneg-grains-ws, WS, sole DB writer)
                 └─ ^~ /onegrainofrice           ─▶ 127.0.0.1:3006  (onegrainofrice, Next.js)
                                                       └─ SQLite: /home/deploy/onegrainofrice/data/grains.db
```

- nginx resolves the country from `$remote_addr` (it is the internet-facing
  edge) and forwards `X-Country-Code` / `X-Country-Name` to both locations.
- The WS server writes every grain to SQLite. The Next app only reads / serves
  the page and mints the `grain_vid` session cookie.

---

## Prerequisites (check first)

On this box, as of setup, these are **NOT yet present** and must be installed:

| Prereq | State | Provided by |
|---|---|---|
| nginx **GeoIP2** module (`ngx_http_geoip2_module`) | ❌ only the legacy `geoip` module is compiled in | `libnginx-mod-http-geoip2` (apt) |
| `geoipupdate` client | ❌ not installed | `geoipupdate` (apt) |
| `GeoLite2-Country.mmdb` | ❌ absent | `geoipupdate` (needs a MaxMind license key) |
| MaxMind account ID + license key | ⚠️ you must obtain (free GeoLite2) | https://www.maxmind.com/en/geolite2/signup |
| pm2 boot resurrection | ✅ `pm2-deploy.service` enabled | already done |

Confirm the module after install:
```bash
nginx -V 2>&1 | tr ' ' '\n' | grep -i geoip        # legacy present already
ls /etc/nginx/modules-enabled/ | grep -i geoip2     # appears after the apt install
```

---

## Step 1 — GeoIP2 data + weekly refresh

1. Create the MaxMind credentials file from the template (fill in real values):
   ```bash
   sudo cp deploy/geoip/GeoIP.conf.example /etc/GeoIP.conf
   sudo chmod 600 /etc/GeoIP.conf
   sudo nano /etc/GeoIP.conf          # paste your AccountID + LicenseKey
   ```
2. Install geoipupdate + the nginx GeoIP2 module, fetch the DB, enable the timer:
   ```bash
   sudo bash deploy/geoip/install-geoipupdate.sh
   ```
   This installs `geoipupdate` + `libnginx-mod-http-geoip2`, runs the first
   `geoipupdate`, and enables `geoipupdate.timer` (weekly, Sun 03:30 ± 1h).
3. Verify:
   ```bash
   ls -l /usr/share/GeoIP/GeoLite2-Country.mmdb
   systemctl list-timers geoipupdate.timer
   ```

After a refresh, nginx reloads the DB on its own via `auto_reload 12h` in the
geoip2 config — **no nginx reload needed** for data updates.

> Never commit `/etc/GeoIP.conf` or the `.mmdb`. Only the `.example` template is
> in git.

## Step 2 — nginx (GeoIP2 vars + country headers + WS proxy)

**Order matters:** install the http-level geoip2 block *before* adding the
`X-Country-*` headers, or `nginx -t` fails with `unknown variable
geoip2_country_code`.

1. Install the geoip2 http block:
   ```bash
   sudo cp deploy/nginx-geoip2.conf /etc/nginx/conf.d/geoip2.conf
   sudo nginx -t && sudo systemctl reload nginx    # validates the module + DB load
   ```
2. Update the `onegrainofrice` server block. Back up first, then **replace** the
   existing single `location ^~ /onegrainofrice { … }` block with the two blocks
   in [`deploy/nginx-onegrainofrice.location`](../../deploy/nginx-onegrainofrice.location)
   (the WS location + the app location with the `X-Country-*` headers):
   ```bash
   sudo cp /etc/nginx/sites-available/ip-rice /etc/nginx/sites-available/ip-rice.bak.$(date +%s)
   sudo nano /etc/nginx/sites-available/ip-rice
   #   delete the old  location ^~ /onegrainofrice { … }  block, then paste the
   #   contents of deploy/nginx-onegrainofrice.location in its place.
   ```
   (Paste manually — a duplicate `location ^~ /onegrainofrice` makes nginx error,
   so this can't just be appended like the original one-block install was.)
3. Validate and reload:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
   If `nginx -t` fails, restore: `sudo cp /etc/nginx/sites-available/ip-rice.bak.* /etc/nginx/sites-available/ip-rice`.

### X-Forwarded-For trust model
nginx is the **edge** — clients connect straight to it, so `$remote_addr` is the
real client IP. nginx sets `X-Forwarded-For` via `$proxy_add_x_forwarded_for`,
which **appends** `$remote_addr` as the last (rightmost) entry. The Phase 2 WS
server trusts the **rightmost** `X-Forwarded-For` entry — the same address
GeoIP2 resolves (`source=$remote_addr`) — so the hashed IP and the attributed
country always agree. If a CDN/extra proxy is ever placed in front of nginx,
update **both** `deploy/nginx-geoip2.conf` (`source=`) and the WS server's
client-IP pick so they stay consistent.

## Step 3 — pm2 (both processes)

Build, then start both apps from the ecosystem so a reboot brings them back.

```bash
cd /home/deploy/onegrainofrice
pnpm install
pnpm build

# First time (replacing the old ad-hoc `pnpm start` process):
pm2 delete onegrainofrice 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

# Subsequent deploys:
pm2 startOrReload ecosystem.config.js --update-env && pm2 save
```

- [`ecosystem.config.js`](../../ecosystem.config.js) defines **onegrainofrice**
  (`next start -p 3006`) and **oneg-grains-ws** (`tsx server/grains-ws/index.ts`,
  `instances: 1` — the sole DB writer). Both get `GRAINS_*` from `.env.local`.
- Reboot resurrection is already enabled (`pm2-deploy.service`); `pm2 save`
  persists the current process list so both return after a reboot.

Make sure `.env.local` on the box has the two required secrets set:
```
GRAINS_IP_SALT=<32+ random chars>
GRAINS_COOKIE_SECRET=<32+ random chars>
# GRAINS_DB_PATH / GRAINS_WS_PORT / GRAINS_MAX_PER_SEC use safe defaults
```

## Step 4 — database persistence & backup

- DB path: **`/home/deploy/onegrainofrice/data/grains.db`** (absolute, set by
  `GRAINS_DB_PATH`). The directory is **auto-created on boot** by the DB module —
  no manual migration; the schema is created idempotently on first open (WAL
  mode, so `-wal`/`-shm` sidecars appear alongside it).
- It lives under `/home/deploy/onegrainofrice/` → inside the home directory that
  the VPS rsync backup covers. **Confirm your backup job includes this path**
  (it is gitignored via `/data/`, so git is not the backup). For a consistent
  copy while running, prefer `sqlite3 grains.db ".backup <dest>"` over copying
  the live file.

---

## Smoke checklist (maps to acceptance)

```bash
# 1) nginx config valid + reloaded
sudo nginx -t && sudo systemctl reload nginx        # "test is successful"

# 2) both processes up
pm2 status                                          # onegrainofrice + oneg-grains-ws = online
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3006/onegrainofrice/grains   # 200

# 3) page + session cookie through nginx
curl -si http://209.141.52.60/onegrainofrice/grains/session | grep -i set-cookie       # grain_vid=…; HttpOnly; SameSite=Lax

# 4) country attribution from a real external IP: open
#    http://209.141.52.60/onegrainofrice/grains in a browser, click a few grains, then:
sqlite3 /home/deploy/onegrainofrice/data/grains.db \
  'SELECT vid, country_code, country_name, total FROM visitors ORDER BY last_seen DESC LIMIT 5;'
#    → country_code is your real country (e.g. US/GB/…), NOT XX.

# 5) WebSocket end-to-end over wss:// — in the browser devtools Network/WS tab the
#    connection to wss://209.141.52.60/onegrainofrice/grains/ws should be 101 and
#    the live counter + leaderboard should climb as you (and other tabs) click.

# 6) reboot persistence (optional, disruptive):
sudo reboot
#    after it comes back:
pm2 status                                          # both online
sqlite3 /home/deploy/onegrainofrice/data/grains.db 'SELECT total FROM global WHERE id=1;'  # unchanged
```

Acceptance is met when: `nginx -t` passes & reload succeeds (1); an external hit
attributes the correct `country_code` in the DB (4); the WS connects over
`wss://` through nginx and the counter/leaderboard work live (5); and both pm2
processes return after a reboot with totals intact (6).

## Rollback

- nginx: `sudo cp /etc/nginx/sites-available/ip-rice.bak.<ts> /etc/nginx/sites-available/ip-rice && sudo nginx -t && sudo systemctl reload nginx`
  (and `sudo rm /etc/nginx/conf.d/geoip2.conf` to drop the geoip2 vars).
- pm2: `pm2 restart onegrainofrice oneg-grains-ws` (or `pm2 delete` + old ad-hoc start).
- Data is untouched by config rollbacks (separate file).
