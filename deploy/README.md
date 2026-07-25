# Deploying $RICE on the VPS at `209.141.52.60/onegrainofrice`

The app is mounted under **basePath `/onegrainofrice`** and runs on **port 3006**
behind the shared nginx gateway (the `ip-rice` default server for `:80`), next
to CXMZ (`/CXMZ/`) and RiceDAO (`/RiceDAO/`).

> **Grains game (GeoIP2 + WebSocket + pm2):** the production edge for the rice
> clicker at `/onegrainofrice/grains` — GeoIP2 country headers, the WS proxy to
> `:3007`, geoipupdate, and the finalized pm2 ecosystem — is documented in
> **[docs/grains/DEPLOY.md](../docs/grains/DEPLOY.md)**. The nginx block below is
> superseded by [nginx-onegrainofrice.location](nginx-onegrainofrice.location)
> (app + WS) once that runbook is applied.

## App process (pm2) — already running

Registered with pm2 as `onegrainofrice`, matching the other apps:

```bash
pm2 start pnpm --name onegrainofrice --cwd /home/deploy/onegrainofrice -- start
pm2 save
```

Useful ops: `pm2 restart onegrainofrice` · `pm2 logs onegrainofrice` · `pm2 stop onegrainofrice`.

After pulling new code: `pnpm install && pnpm build && pm2 restart onegrainofrice`.

## nginx route — needs root (run these once)

Adds a `location ^~ /onegrainofrice` proxy to `127.0.0.1:3006`. The block lives
in [nginx-onegrainofrice.location](nginx-onegrainofrice.location); the command
inserts it into the existing `ip-rice` server block (right after `server_name`),
backs the file up first, validates, then reloads:

```bash
sudo cp /etc/nginx/sites-available/ip-rice /etc/nginx/sites-available/ip-rice.bak.$(date +%s)
sudo sed -i '/server_name 209.141.52.60 _;/r /home/deploy/onegrainofrice/deploy/nginx-onegrainofrice.location' /etc/nginx/sites-available/ip-rice
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` must print `syntax is ok` / `test is successful` before the reload
runs (the `&&` guards it). If it fails, restore the backup:
`sudo cp /etc/nginx/sites-available/ip-rice.bak.* /etc/nginx/sites-available/ip-rice`.

## Verify

```bash
# app directly (should already work)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3006/onegrainofrice   # 200

# through nginx after the reload
curl -s -o /dev/null -w '%{http_code}\n' http://209.141.52.60/onegrainofrice     # 200
```

Then open **http://209.141.52.60/onegrainofrice** in a browser.

## Why basePath + no collisions

nginx already routes root-level `/_next/` to CXMZ and `/memes/` to RiceDAO. This
app namespaces everything under `/onegrainofrice/…` (via `basePath` and the
`asset()` helper on image `src`), and nginx prefix-matching sends the longer
`/onegrainofrice` prefix here — so `/onegrainofrice/_next/…` and
`/onegrainofrice/memes/…` never fall through to the other apps.
