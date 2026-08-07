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

## Deploying new code — build and deploy are SEPARATE

> The old `pnpm build && pm2 restart` built **in place**: `next build` overwrote
> the same `./.next` the live process was serving, so for a few minutes the
> running site referenced chunks that no longer existed on disk (stale-chunk
> 404s). Building was, in effect, deploying. **That flow is retired.** Use the
> two scripts below.

**1. Build (safe — never touches the live site):**

```bash
deploy/build.sh
```

Writes a complete, self-consistent build to `builds/<git-short-sha>/` via
`NEXT_DIST_DIR` (see `next.config.ts`). It never writes `./.next`, never restarts
pm2, and never touches `oneg-grains-ws` (:3007). Run it as often as you like,
including while the site is live. It verifies the build (`BUILD_ID`, manifests,
static chunks) and prints the promote command.

> **NEVER call `pnpm build` directly — always `deploy/build.sh`.** *Added
> 2026-08-07, after doing exactly that.* `next build` **mutates tracked
> `tsconfig.json`**: it manages the `include` list for `<distDir>/types`, so a
> direct call with a `NEXT_DIST_DIR` outside the repo bakes that **absolute path**
> into `tsconfig.json` and leaves the tree dirty. It also reformats the whole file
> (every array expanded one-entry-per-line), so the diff is large and the one line
> that matters is buried in it, and an absolute dist dir additionally leaves a
> stray `tmp/` tree in the repo root.
>
> `build.sh` snapshots `tsconfig.json` before the build and restores it on exit —
> success **or** failure — so a build leaves the repo byte-identical. That trap is
> the whole reason the snapshot exists.
>
> **This fails silently**, which is why it is written down: nothing errors, the
> build succeeds, the site is fine, and the damage is a committed `tsconfig.json`
> pointing at a path that exists on exactly one machine. Recover with
> `git checkout tsconfig.json && rm -rf tmp/`.

**2. Promote (a separate, deliberate act — you run it, watching):**

```bash
deploy/promote.sh <sha>     # the sha build.sh just printed
```

Repoints `./.next -> builds/<sha>` and `pm2 restart onegrainofrice`. Because each
build is internally consistent there is **no stale-chunk 404 window** — the only
gap is the ~1s restart 502. It stamps a `DEPLOYED` marker (deployed id, repo HEAD,
dirty-file count, timestamp) and prints it, so a deploy can always say what it
shipped. The **first** promote migrates `./.next` from a real directory to a
symlink, preserving the current live build as `builds/premigrate-<old-build-id>`
so there is a rollback floor.

**Rollback (one command — the previous build is kept, never deleted):**

```bash
deploy/promote.sh <previous-sha>
```

`builds/` is git-ignored (build artifacts, like `.next`). Prune old builds
manually when disk warrants; never delete the build `./.next` currently points at
or its immediate predecessor.

> Note: nginx fronts the live site at **1grainofrice.com** (`location / ->
> 127.0.0.1:3006`, `NEXT_PUBLIC_BASE_PATH=""`, app served at root). The
> `/onegrainofrice`-prefix section below is the older shared-IP gateway and is
> not the live path.

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
