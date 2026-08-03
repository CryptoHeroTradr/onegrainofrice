# RICE CHOMP — recon & build plan

**Status:** planning only. No gameplay code, components, routes, config or dependencies
have been added. This document and `docs/rice-chomp-plan.md` are the only artefacts.

> ### ⚠️ The spec is missing
> `docs/rice-chomp-spec.md` **is not present.** `docs/` contains only `docs/grains/`
> (`DEPLOY.md`, `LOADTEST.md`, `RECON.md`). A search across `/home/deploy` and `/tmp`
> for `*chomp*` / `*rice-chomp*` returned nothing outside this file.
>
> Everything below is derived from (a) the repo as it actually is and (b) the brief in
> the request. Anything the spec would have pinned down — pest names and personalities,
> scoring table, level curve, art direction, sound design — is listed as an open
> question rather than invented. See **Open questions**.

---

## 1. Routing and build

### 1.1 basePath — the live value is `""`, not `/onegrainofrice`

`next.config.ts:12`:

```ts
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/onegrainofrice";
```

The `??` fallback is what you see everywhere in the source, but **it is not what
production uses.** `.env.local` sets `NEXT_PUBLIC_BASE_PATH=""` ("Serve at the domain
root (dedicated domain 1grainofrice.com). Empty = …"), and `""` is not nullish, so the
fallback never fires.

Verified live against the running process:

```
$ curl -s http://127.0.0.1:3006/ | grep -o '/_next/static/[^"]*' | head -3
/_next/static/chunks/2hz-efn8bx4ic.css
/_next/static/chunks/149uv3hypf7m_.js
/_next/static/chunks/43j1mapxxuwgu.js
```

No `/onegrainofrice` prefix. `deploy/nginx-1grainofrice.com:3-4` says the same:
*"Serves ONLY the onegrainofrice Next.js app (built at the true root,
`NEXT_PUBLIC_BASE_PATH=""`), proxied to :3006"*.

The `/onegrainofrice` default is a legacy sub-path mount (the old shared IP gateway,
`/etc/nginx/sites-available/ip-rice`, still has `location ^~ /onegrainofrice/grains/ws`).
**Practical consequence for RICE CHOMP: never hardcode either prefix.**

### 1.2 How routes / assets / links handle basePath

| Thing | Handling | Where |
|---|---|---|
| `<Link>` / `useRouter` / `usePathname` | Next prefixes/strips automatically | `src/components/journey/SiteMenu.tsx:42-44` documents this |
| `<img src>` / `next/image` / CSS `url()` / audio | **NOT** auto-prefixed — must wrap in `asset()` | `src/lib/asset.ts` |
| `fetch()` to own API | `asset("/api/…")` — prefix only, no `?v=` stamp | `asset.ts:26`, used at `GrainCatch.tsx:37` |
| Public assets | `asset()` also appends `?v=<BUILD_ID>` for immutable caching | `asset.ts:27-30`, `next.config.ts:79-112` |
| WebSocket URL | manual: `${proto}//${host}${BASE_PATH}/grains/ws` | `src/hooks/useGrainsSocket.ts:93-101` |

`images.unoptimized = true` (`next.config.ts:135`) — the optimizer is off, so plain
`<img>`/`next/image` both serve the raw file. Good for a game: no optimizer round-trip.

### 1.3 App Router, and the page/component convention

**App Router.** `src/app/`, no `pages/` directory anywhere.

Existing routes: `/` (`src/app/page.tsx`), `/home`, `/memes`, `/pfp`, `/charity`,
`/dca`, `/tma`, `/classic`, `/play`, plus `src/app/grains/session/route.ts` and eleven
handlers under `src/app/api/`.

The convention is consistent and worth copying exactly:

```tsx
// src/app/page.tsx — server component, ~20 lines, no logic
import type { Metadata } from "next";
import { GrainsScreen } from "@/components/grains/GrainsScreen";

export const metadata: Metadata = { title: "…", description: "…" };
export const dynamic = "force-dynamic";   // only when the route truly needs it

export default function Landing() {
  return <GrainsScreen enterWebsiteHref="/home" />;
}
```

- **`src/app/<route>/page.tsx`** — thin server component: `metadata`, maybe a
  `dynamic`/`revalidate` export, and one client component.
- **`src/components/<domain>/*.tsx`** — the actual UI, `"use client"` at the top.
  Domains today: `grains/`, `dca/`, `pfp/`, `charity/`, `memes/`, `journey/`, `rice/`,
  `eggs/`, `sections/`, `primitives/`, `brand/`.
- **Engine / pure logic sits beside its component with no directive** —
  `src/components/grains/riceBowlEngine.ts` (523 lines) has *no* `"use client"`; it is a
  plain module imported by `RiceBowlCanvas.tsx`, which does.
- **`src/hooks/use*.ts`** — client hooks (`"use client"`).
- **`src/lib/<domain>/*.ts`** — server-only modules (`grains/db.ts`, `grains/env.ts`,
  `grains/cookie.ts`, `grains/handle.ts`) and isomorphic pure helpers
  (`grains/flag.ts`, `asset.ts`).
- **`src/app/api/<name>/route.ts`** — route handlers.
- **`src/config/*.ts`** — static config (`site.ts`, `home.ts`, `memes.ts`).

Nav is data-driven: `src/config/home.ts:19-25` `homeNavLinks` feeds
`src/components/journey/SiteMenu.tsx:24-27`. Adding RICE CHOMP to the menu is a
one-line entry there.

`src/middleware.ts` runs on every page route (matcher excludes `_next/static`,
`_next/image`, `api/`, and static file extensions) and stamps a `rice_geo_lang` cookie
from `x-country-code`. A new `/chomp` page **is** covered by it; that's harmless.

### 1.4 Tailwind v4 — theme tokens

Tailwind v4 CSS-first. No `tailwind.config.*` exists. `postcss.config.mjs` loads
`@tailwindcss/postcss`. Tokens live in one `@theme` block:
**`src/app/globals.css:8-35`**.

```css
@theme {
  /* zine palette */
  --color-ink:         #17150f;
  --color-paper:       #eae3d2;
  --color-paper-dark:  #d9cfb8;
  --color-bone:        #f4efe2;
  --color-olive:       #6a6c3a;
  --color-olive-deep:  #474d2e;
  --color-khaki:       #c4b370;

  /* ceramic palette */
  --color-steamed:     #fbf7ee;   /* steamed-rice cream, page base */
  --color-porcelain:   #2a4d8f;   /* blue-and-white porcelain, borders */
  --color-bamboo:      #4e7a3e;   /* bamboo green */
  --color-nori:        #14110d;   /* nori black */
  --color-salmon:      #f4a08a;
  --color-tuna:        #c1443a;

  --font-display:       var(--font-display-next),       "Zilla Slab", Georgia, serif;
  --font-display-slab:  var(--font-display-next),       "Zilla Slab", Georgia, serif;
  --font-display-round: var(--font-display-round-next), "Fredoka", ui-rounded, …;
  --font-mono:          var(--font-mono-next),          "Courier Prime", "Courier New", monospace;

  --shadow-sticker: 0 10px 24px -8px rgba(23, 21, 15, 0.55);
}
```

These generate both utilities (`bg-steamed`, `text-tuna`, `font-display-round`) **and**
raw CSS variables — which matters for canvas: the engine can read
`getComputedStyle(el).getPropertyValue("--color-khaki")`, or just hardcode the hexes as
`riceBowlEngine.ts` does (it uses `#c4b370` inline, and `GrainCatch.tsx:100` uses
`ctx.fillStyle = "#c4b370"`). **Precedent is to hardcode the hex in the engine.**

Fonts (`src/app/fonts.ts`), wired onto `<html>` in `src/app/layout.tsx:53-56`:
- **Zilla Slab** (`next/font/google`, 500/700, normal+italic) → `--font-display-next`
- **Fredoka** (`next/font/local`, `public/fonts/fredoka-latin-{400,500,600,700}-normal.woff2`) → `--font-display-round-next`
- **Courier Prime** (`next/font/google`, 400/700) → `--font-mono-next`; `body` uses mono

`body` is `bg-ink text-paper` (`layout.tsx:57`) — a dark page by default. Game routes
override per-page (e.g. `/play` uses `bg-steamed`, `src/app/play/page.tsx:9`).

### 1.5 TypeScript, lint, and what will bite a canvas component

`tsconfig.json`: `strict: true`, `target: ES2017`, `lib: ["dom","dom.iterable","esnext"]`,
`moduleResolution: "bundler"`, `isolatedModules: true`, `noEmit`, `jsx: "react-jsx"`,
`paths: { "@/*": ["./src/*"] }`. **No** `noUncheckedIndexedAccess`, **no**
`exactOptionalPropertyTypes` — so `grid[y][x]` indexing won't fight you.
`pnpm typecheck` = `tsc --noEmit`.

`eslint.config.mjs` is `eslint-config-next/core-web-vitals` + `.../typescript`, nothing
custom. Things that will actually bite:

1. **`react-hooks/exhaustive-deps`** on a rAF loop with refs. The repo's answer is an
   inline disable — `useGrainsSocket.ts:187` and `db.ts:167` both do this. Copy that
   rather than restructuring the loop.
2. **`@next/next/no-img-element`** if sprites are `<img>`. Avoid by drawing everything
   on canvas (which is the plan) or by prebaking sprites into offscreen canvases.
3. **`target: ES2017`** — no `??=`, no `.at()`, no class fields downlevelling
   surprises; fine for a game loop, but don't reach for newer syntax without checking.
4. **`isolatedModules`** — type-only re-exports need `export type`.
5. **Canvas 2D types are on** (`lib: dom`), so `CanvasRenderingContext2D`,
   `OffscreenCanvas`, `ResizeObserver` all typecheck.
6. `next build` **mutates tracked `tsconfig.json`** (it manages the `include` list for
   `<distDir>/types`). `deploy/build.sh:54-58` snapshots and restores it. Don't be
   surprised by a dirty tsconfig after a bare `next build`.

Tests: `vitest.config.ts` is deliberately **`environment: "node"`, DOM-free**,
`include: ["test/**/*.test.ts"]`, with the `@/*` alias. So RICE CHOMP can get real unit
tests for the maze, the pest targeting math and the score validator — but **no render
tests** without adding jsdom (which the config's comment argues against on purpose).

---

## 2. The existing clicker game ("grains")

### 2.1 Where the code lives

**Client**
| File | Role |
|---|---|
| `src/app/page.tsx` | the route — the landing page *is* the game |
| `src/components/grains/GrainsScreen.tsx` | the whole screen: HUD, mascot, leaderboards, share, sound |
| `src/components/grains/RiceBowlCanvas.tsx` | canvas host — rAF loop, DPR sizing, `ResizeObserver`, imperative handle |
| `src/components/grains/riceBowlEngine.ts` | the engine (heightfield sandpile, offscreen-canvas blitting) |
| `src/components/grains/{CountryLeaderboard,PlayersLeaderboard,GrainsCounter,AnimatedNumber,FloatingText,LiveAnnouncer,ShareButton,ContractChip,RiceFarmer}.tsx` | HUD parts |
| `src/hooks/useGrainsSocket.ts` | the socket client (session-ensure, backoff, buffering, optimistic counter) |
| `src/lib/sound.ts` | SFX + a persisted global sound toggle (`isSoundOn`, `setSoundOn`, `subscribeSound`, `playClack`, `playPour`, `playMilestone`, `preloadMilestones`) |

**Server**
| File | Role |
|---|---|
| `server/grains-ws/index.ts` | the WS server — **the only process that writes the DB** |
| `src/lib/grains/db.ts` | SQLite: connection, schema, migration, data API |
| `src/lib/grains/env.ts` | `GRAINS_*` env read + validation (memoized, throws on missing secrets) |
| `src/lib/grains/cookie.ts` | signed `grain_vid` cookie (HMAC-SHA256, `timingSafeEqual`) |
| `src/lib/grains/handle.ts` | deterministic anonymous player handle from a vid |
| `src/lib/grains/flag.ts` | isomorphic ISO-code → emoji flag / friendly name |
| `src/app/grains/session/route.ts` | mints + signs the `grain_vid` cookie |

Second, unrelated mini-game: `src/app/play/page.tsx` → `src/components/eggs/GrainCatch.tsx`
(canvas, session-only high score via `src/lib/highscore.ts`, community board proxied
from RiceDAO through `src/app/api/leaderboard/route.ts`). **`highscore.ts` is a module
variable — it resets on reload and is per-server-instance. Not a persistence layer.**

### 2.2 The SQLite layer

- **Library:** `better-sqlite3` `^12.11.1` (+ `@types/better-sqlite3`). Synchronous.
- **File:** `GRAINS_DB_PATH`, live value `/home/deploy/onegrainofrice/data/grains.db`.
  Default when unset: `<cwd>/data/grains.db` (`env.ts:41-45`).
- **Connection:** lazy module singleton, `getDb()` (`db.ts:71-103`). Creates the
  directory, then sets `journal_mode = WAL`, `synchronous = NORMAL`,
  `foreign_keys = ON`, `busy_timeout = 5000`.
- **Migration approach:** no version table, no migration tool. `migrate()`
  (`db.ts:109-148`) runs on every open:
  1. one `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` block,
  2. `INSERT OR IGNORE` to seed the singleton `global` row,
  3. **additive columns guarded by a live `PRAGMA table_info` check** — that's how
     `display_name` was added after the table shipped.
- **Writes:** every multi-row write is one `handle.transaction(…)` — see
  `addGrains()` (`db.ts:297-367`), which reads before-totals *inside* the transaction so
  milestone detection is race-free.
- **Live schema** (dumped from the running DB — matches `migrate()` exactly):

```sql
CREATE TABLE visitors (
  vid TEXT PRIMARY KEY, ip_hash TEXT, country_code TEXT, country_name TEXT,
  total INTEGER NOT NULL DEFAULT 0, first_seen INTEGER, last_seen INTEGER,
  display_name TEXT);
CREATE TABLE countries (code TEXT PRIMARY KEY, name TEXT, total INTEGER NOT NULL DEFAULT 0);
CREATE TABLE global   (id INTEGER PRIMARY KEY CHECK (id = 1), total INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_countries_total ON countries (total DESC);
CREATE INDEX idx_visitors_ip_hash ON visitors (ip_hash);
CREATE INDEX idx_visitors_total ON visitors (total DESC);
```

- **Single-writer invariant.** `ecosystem.config.js:92` — `instances: 1, // MUST stay 1:
  this is the sole DB writer.` The Next process does **not** touch `grains.db` at all
  today (`src/app/grains/session/route.ts` only signs a cookie). This constrains the
  leaderboard design; see §5.

### 2.3 The WebSocket layer

- **Where it runs:** `server/grains-ws/index.ts`, a standalone Node process launched by
  pm2 as `oneg-grains-ws` via `node --import tsx server/grains-ws/index.ts`
  (`ecosystem.config.js:84-101`). Port `GRAINS_WS_PORT` = **3007**. Native `ws`, no
  socket.io. `maxPayload: 1024` bytes.
- **Surviving PM2:** `exec_mode: fork`, `instances: 1`, `autorestart: true`,
  `max_restarts: 20`, `restart_delay: 3000`, `max_memory_restart: "256M"`,
  `kill_timeout: 4000`, plus explicit `SIGINT`/`SIGTERM` handlers that clear timers,
  close every socket with 1001, and `wss.close()` with a 2s failsafe exit
  (`index.ts:382-398`). Reboot resurrection via `pm2 save` + the enabled
  `pm2-deploy.service`.
  **Crucially, `deploy/promote.sh` restarts `onegrainofrice` only** — it explicitly
  never touches :3007 (`promote.sh:12-14, 86`). So the socket survives a web deploy.
  Live uptime confirms it: `oneg-grains-ws` 17 days, `onegrainofrice` 37 hours.
- **nginx proxy:** `deploy/nginx-1grainofrice.com:25-38` (installed as
  `/etc/nginx/sites-enabled/1grainofrice`):

```nginx
location ^~ /grains/ws {
    proxy_pass http://127.0.0.1:3007;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Country-Code $geoip2_country_code;
    proxy_set_header X-Country-Name $geoip2_country_name;
}
```

  The `^~` prefix beats the `location /` proxy to :3006.
- **Client connect under basePath:** `useGrainsSocket.ts:93-101` builds
  `${ws|wss}://${host}${BASE_PATH}/grains/ws`, with a `NEXT_PUBLIC_GRAINS_WS_URL`
  dev override. With the live `BASE_PATH=""` that resolves to `/grains/ws`. The path is
  deliberately under the basePath so the `grain_vid` cookie (scoped to `Path=<basePath>`,
  `session/route.ts:29`) is sent on the upgrade. The hook calls
  `POST ${BASE_PATH}/grains/session` **before** opening the socket, because the server
  refuses to mint (`index.ts:162-167`, close code `4401`).
- **Protocol:** client → `{type:"grain",delta}` / `{type:"name",name}`; server →
  `init` / `you` / `name` / `tick`. 250 ms throttled broadcast, only when dirty.
  30 s ping/pong heartbeat. Backpressure guard at 1 MiB `bufferedAmount`.

### 2.4 GeoIP country attribution

nginx does all of it — there is no GeoIP library in the app.

- `deploy/nginx-geoip2.conf` → `/etc/nginx/conf.d/geoip2.conf`, requires
  `ngx_http_geoip2_module` (`libnginx-mod-http-geoip2`) and
  `/usr/share/GeoIP/GeoLite2-Country.mmdb` kept fresh by `geoipupdate`
  (`deploy/geoip/`, MaxMind creds in `.env.local`). `auto_reload 12h`.

```nginx
geoip2 /usr/share/GeoIP/GeoLite2-Country.mmdb {
    auto_reload 12h;
    $geoip2_country_code source=$remote_addr default=XX      country iso_code;
    $geoip2_country_name source=$remote_addr default=Unknown country names en;
}
```

- Both server locations (`/` → :3006 and `/grains/ws` → :3007) inject
  `X-Country-Code` / `X-Country-Name`.
- Consumers: `server/grains-ws/index.ts:171-172` (`header(req,"x-country-code")`,
  default `"XX"` / `"Unknown"`), and `src/middleware.ts:27` for language guessing.
- Presentation: `src/lib/grains/flag.ts` (`flagEmoji`, `friendlyCountryName`) —
  isomorphic, no node builtins, importable from a client component.

**Can RICE CHOMP reuse it verbatim? Yes, with no nginx change**, as long as it stays on
this vhost. Any Next route handler can read `req.headers.get("x-country-code")` /
`"x-country-name"` — the header is already on the `location /` block. `flag.ts` is
directly reusable in the leaderboard UI. The only thing that would need nginx (and
therefore sudo, which I do not have) is a **new** WebSocket path or port.

### 2.5 Anti-cheat and score validation — honest assessment: **weak**

What exists:

| Control | Where | Strength |
|---|---|---|
| HMAC-signed, HttpOnly, `SameSite=Lax` `grain_vid` cookie, constant-time verify | `cookie.ts` | Solid *as an identity binding*. Not a proof of anything. |
| Token bucket: `GRAINS_MAX_PER_SEC` (default 20/s), 1 s burst | `index.ts:282-292` | Caps throughput per connection. |
| `MAX_DELTA = 100_000` per message | `index.ts:40` | Sanity cap only; the bucket is what binds. |
| `maxConnPerIp` (default 8) per **IP hash** | `index.ts:174-178` | The only real global bound. |
| `maxPayload: 1024`, malformed input silently dropped | `index.ts:242-280, 367` | Protocol hygiene. |
| `NAME_COOLDOWN_MS = 2000` per connection | `index.ts:49, 257-273` | Rename rate limit. |
| Server-side `sanitizeName()` — never trusts the client string | `db.ts:164-173` | Good. |
| Salted one-way IP hash; raw IP never stored | `db.ts:202-207` | Privacy, not anti-cheat. |

What does **not** exist, and matters:

1. **`/grains/session` will mint unlimited identities.** It is `force-dynamic`, has no
   rate limit, no captcha, no proof-of-work. `POST` in a loop → as many signed vids as
   you like.
2. **The per-IP cap is the entire ceiling.** 8 connections × 20 grains/s ≈ **160
   grains/sec per IP**, indefinitely, from `curl`. Behind a proxy pool that scales
   linearly.
3. **Nothing ties a grain to a real interaction.** The server accepts a number. There is
   no simulation, no replay, no timing analysis, no gameplay proof.
4. **The client mirrors its own total in `localStorage`** (`useGrainsSocket.ts:24,
   181-198`) and the server adopts it only if ahead (`Math.max`) — so the mirror can't
   inflate the DB, but the *displayed* number is trivially editable.

Summary: the grains anti-cheat is a **throughput clamp, not verification.** That is a
defensible choice for a "tap a counter" toy where inflation is cosmetic. It is a *worse*
fit for RICE CHOMP, where a leaderboard rank is the whole point and a naive
`POST {score: 999999}` would be strictly weaker than what grains has today. See open
question 5 — this needs a decision before I build the submit path.

---

## 3. Deployment reality

### 3.1 How it's built and run

**pm2** (`ecosystem.config.js`), 2 processes for this app:

| pm2 name | script | port | notes |
|---|---|---|---|
| `onegrainofrice` | `node node_modules/next/dist/bin/next start -p 3006` | 3006 | `max_memory_restart: 512M`, fork, instances 1 |
| `oneg-grains-ws` | `node --import tsx server/grains-ws/index.ts` | 3007 | `max_memory_restart: 256M`, **instances MUST stay 1** |

Both get `.env.local` injected by a hand-rolled parser in `ecosystem.config.js:29-55`
(Next also loads `.env.local` itself; the injection is for parity with the WS process).

Neighbours on the box (`pm2 list`): `cxmz-site`, `ricedao-server` (:1112),
`ricedao-web` (:1111).

**Build → promote is a two-step, symlink-swap model** (this is not "build in place"):

1. `deploy/build.sh` — `NEXT_DIST_DIR=builds/<sha> BUILD_ID=<sha> pnpm build`, so a build
   **never** writes the `.next` the live process is serving. Refuses to build the sha
   that is currently live. Verifies `BUILD_ID`, manifests, `static/chunks/*.js`. Aborts
   if `.env.local` is missing (**because basePath is baked in at build time**).
   Snapshots/restores `tsconfig.json`.
2. `deploy/promote.sh <sha>` — `ln -sfn builds/<sha> .next` then
   `pm2 restart onegrainofrice`. **Only the web process.** The same command is the
   rollback. Every previous build is kept in `builds/`.

Live right now: `.next -> builds/4f7f431`, HEAD `4f7f431`, branch `main`, clean tree.

**nginx** (`/etc/nginx/sites-enabled/`, repo copies in `deploy/`):
`1grainofrice` (this app, `deploy/nginx-1grainofrice.com`), `game.1grainofrice.com`
(RiceDAO, `deploy/nginx-game.1grainofrice.com`), `cxmz-site`, `00-blackhole`.
`certbot --nginx` adds the 443 blocks on top of the repo copies, so the installed file
is a superset of the repo file.

### 3.2 Does a canvas game route need a process or proxy change?

**No — it rides along entirely**, provided it uses HTTP:

- A new page at `/chomp` → served by the existing `location /` → :3006. No nginx change.
- New route handlers under `/api/chomp/*` → same. No nginx change. (The `middleware.ts`
  matcher excludes `api/`, so no interference.)
- New static assets in `public/chomp/` → same, and they pick up the immutable
  `?v=<BUILD_ID>` caching automatically via `asset()`.
- Deploy = `deploy/build.sh` + `deploy/promote.sh <sha>`. One `pm2 restart onegrainofrice`.

**It would need a change** only if RICE CHOMP wanted its own WebSocket path or port —
that requires a new nginx `location` block and a reload, i.e. **sudo, which I do not
have**. This is the single strongest argument for the HTTP leaderboard in §5.

---

## 4. Risks

### 4.1 Things that will make this awkward here

1. **`ChopstickCursor` is mounted globally** (`layout.tsx:63`) and adds
   `chopsticks-active` to `<body>`, which sets `cursor: none` **site-wide**
   (`globals.css:223-225`), plus a fixed `z-index: 9999` overlay tracking the pointer.
   A maze game does not want a chopstick following the mouse over its HUD. RICE CHOMP
   must opt out (a route check in `ChopstickCursor`, or a wrapper class).
2. **Global pointer listeners.** `src/lib/sound.ts:311` mentions "its own window-level
   `pointerdown` listener, which `GrainsScreen` has no handle on". `KonamiRice` and
   `RiceProvider` are also global (`layout.tsx:59-62`). A `keydown`-driven game shares
   the window with a Konami-code listener — arrow keys are literally the Konami prefix.
   **Arrow-key input will feed KonamiRice.** Needs checking/coordination.
3. **Google Translate is mounted globally** (`TranslateProvider`, `layout.tsx:58`) and
   `globals.css:481-484` forces `body { top: 0 !important; position: static !important }`
   to undo its layout shove. Translate rewrites text nodes — it will happily translate
   the HUD, "GAME OVER", and possibly mangle score digits mid-game. A game HUD should be
   marked `translate="no"` / `.notranslate`.
4. **`prefers-reduced-motion` has an all-or-nothing precedent.** `GrainCatch.tsx:179-183`
   *disables the game entirely* under reduced motion. Copying that means RICE CHOMP is
   unplayable for those users; not copying it is an inconsistency. Needs a decision
   (open question 7).
5. **DPR is capped in existing canvas code** — 2.5 in `RiceBowlCanvas.tsx:107`, 2.0 in
   `GrainCatch.tsx:57`. A full-screen 28×31 maze on a 3× phone is a lot of pixels;
   the cap is mandatory, not optional.
6. **No touch input primitives exist anywhere in the repo.** The belt has a drag scrub
   (`globals.css:532-537`, `touch-action: pan-y`) and canvases use
   `touch-action: none` — but there is no d-pad, no swipe-direction detection, no
   virtual stick. All new work.
7. **The WS server is single-instance by contract.** Any realtime leaderboard must not
   fight `instances: 1`, and must not add a second writer to `grains.db`.
8. **`vitest` is node-env and DOM-free by design.** Only pure logic is testable. Render
   and input behaviour will be manual-QA'd unless jsdom is added (which the config
   argues against on purpose).
9. **basePath is baked at build time** and defaults to `/onegrainofrice` if `.env.local`
   is absent. Anything hardcoding a prefix breaks in one environment or the other.
10. **No sudo.** nginx, systemd, and `/usr/share/GeoIP` are out of reach for me.

### 4.2 Broken / fragile things I found adjacent to this work

1. **`globals.css:293` is a live 404.**

   ```css
   .grains-play-area { cursor: url("/onegrainofrice/grains/chopstick-cursor.svg") 6 5, auto; }
   ```

   The basePath is `""` in production, so the correct path is `/grains/…`. Verified:

   ```
   /onegrainofrice/grains/chopstick-cursor.svg -> 404
   /grains/chopstick-cursor.svg                -> 200
   ```

   The custom cursor silently falls back to `auto` on the grains play area for every
   visitor. One-character-class fix, but it's *not* mine to make in this phase —
   flagged for approval (open question 9). CSS can't read `NEXT_PUBLIC_BASE_PATH`, so
   the real fix is either a hardcoded root path or a CSS variable set from JS.

2. **The SQLite WAL is not checkpointing.**

   ```
   grains.db      143 KB
   grains.db-wal  4.1 MB     <- 29× the database
   grains.db-shm   32 KB
   ```

   The writer process never closes, so no passive checkpoint completes while readers
   keep the WAL pinned. Not currently harmful (WAL is durable), but it grows unbounded
   and a crash means a long recovery. Worth a periodic
   `PRAGMA wal_checkpoint(TRUNCATE)` in the WS tick loop. **A second SQLite database for
   RICE CHOMP will have the same characteristic** — worth designing in from the start.

3. **`onegrainofrice` has restarted 31 times in 37 hours** (`pm2 list` ↺ column) while
   `oneg-grains-ws` has 0 restarts in 17 days. Some of those are deploys, but 31 is a
   lot — could be `max_memory_restart: 512M` firing. A memory-hungry canvas game on the
   same process makes this worse. Worth checking `pm2 logs onegrainofrice --err` before
   Phase 2.

4. **`src/lib/highscore.ts` is a module-level variable on the server.** In a single fork
   process it happens to behave like a global shared across all users; the doc comment
   claims "session-only … resets on reload", which is only true because the client reads
   it at render. It is not a per-user store. Not used by RICE CHOMP, but don't copy it.

---

## 5. Proposed file tree

Corrected against the real conventions above (thin `page.tsx` → `"use client"` screen →
directive-free engine modules → server-only `src/lib/<domain>/`).

```
src/app/chomp/page.tsx                       server component: metadata + <ChompScreen />
                                             (static — leaderboard fetched client-side, so
                                              NO force-dynamic, keeps the prerender)

src/app/api/chomp/score/route.ts             POST — submit a run. runtime "nodejs",
                                             dynamic "force-dynamic"
src/app/api/chomp/leaderboard/route.ts       GET  — top N + your best. no-store

src/components/chomp/ChompScreen.tsx         "use client" — shell: HUD, overlays, pause,
                                             game-over, name entry, leaderboard, sound toggle
src/components/chomp/ChompCanvas.tsx         "use client" — canvas host. rAF loop, DPR cap,
                                             ResizeObserver, imperative handle.
                                             MIRRORS RiceBowlCanvas.tsx almost 1:1
src/components/chomp/TouchControls.tsx       "use client" — swipe surface + optional d-pad
src/components/chomp/ChompLeaderboard.tsx    "use client" — board. mirrors PlayersLeaderboard.tsx,
                                             reuses @/lib/grains/flag

src/components/chomp/engine/maze.ts          MAZE rows, tile enum, warp/wrap, pellet count,
                                             tile<->pixel helpers        (pure, no directive)
src/components/chomp/engine/types.ts         Dir, Tile, Entity, GameState, RunSummary
src/components/chomp/engine/pests.ts         the four chasers' targeting + mode timers
src/components/chomp/engine/game.ts          fixed-timestep step(), collisions, scoring, levels
src/components/chomp/engine/render.ts        draw(ctx, state) — pure painting, no React
src/components/chomp/engine/sprites.ts       offscreen-canvas prebake
                                             (the riceBowlEngine blit trick, engine.ts:15-19)

src/lib/chomp/db.ts                          better-sqlite3. own file, own migrate().
                                             MIRRORS src/lib/grains/db.ts structure exactly
src/lib/chomp/env.ts                         CHOMP_DB_PATH + tunables.
                                             MIRRORS src/lib/grains/env.ts
src/lib/chomp/score.ts                       server-side run validation (see open question 5)

test/chomp-maze.test.ts                      28x31, symmetry, full connectivity, no dead ends,
                                             pellet count, tunnel wrap
test/chomp-pests.test.ts                     targeting math (pure fns) per personality
test/chomp-score.test.ts                     score validator accepts/rejects the right runs
```

**Reused, not rewritten:**
`src/lib/grains/cookie.ts` (vid auth on the API routes) · `src/lib/grains/handle.ts`
(anonymous names) · `src/lib/grains/flag.ts` (leaderboard flags) · `src/lib/asset.ts`
(any public asset) · `src/lib/sound.ts` (the global sound toggle + `subscribeSound`) ·
`src/hooks/usePrefersReducedMotion.ts` · the `x-country-code` / `x-country-name` headers.

**Touched, one line each:** `src/config/home.ts` (`homeNavLinks` entry) and possibly
`src/components/rice/ChopstickCursor.tsx` (opt out on `/chomp`).

**Not proposed:** no new dependency, no new pm2 process, no nginx change, no new port.

---

## 6. Leaderboard integration plan

### Decision: **new HTTP API routes + a separate SQLite file. Do not extend the WS server.**

**Why not the WebSocket.** It's the tempting option — the socket already has cookie
auth, GeoIP headers, per-IP caps and a live leaderboard broadcast. But:

- `oneg-grains-ws` is **the sole writer to `grains.db` by explicit contract**
  (`ecosystem.config.js:92`). Bolting a second game's write path onto it makes one
  process responsible for two unrelated games, and any RICE CHOMP bug takes the
  landing-page counter down with it. Note it is also the *only* process with 0 restarts
  in 17 days — that reliability is worth not disturbing.
- A score submit is **one discrete event per game**, not a stream. Holding a socket open
  for the whole run to send a single message at the end is the wrong shape.
- Every RICE CHOMP page would join the grains broadcast and receive a `tick` with two
  full leaderboards every 250 ms while the player is trying to hold 60 fps.
- A *separate* WS server would need a new nginx `location` block → **sudo, which I don't
  have.** HTTP needs nothing.
- Redeploying the WS server means restarting :3007, which `deploy/promote.sh`
  deliberately never does. Shipping RICE CHOMP would start requiring a manual, riskier
  deploy step.

**Why HTTP + a separate DB file works.** The Next process is `exec_mode: fork,
instances: 1` — so it is *also* a single writer, for `chomp.db`. Two processes, two
database files, one writer each; the grains invariant is untouched. `better-sqlite3` is
already a dependency. `.env.local` is already injected into the Next process, so
`GRAINS_COOKIE_SECRET` is available for vid verification. The GeoIP headers are already
on `location /`.

**Read path:** `GET /api/chomp/leaderboard` with `cache: "no-store"` from the client,
polled after each run and on an interval on the game-over screen (the existing
`/api/leaderboard` proxy uses `revalidate = 60`; for a live board, `no-store` +
client polling is the closer fit). If you later want it truly live, adding a `chomp`
message type to the existing socket is a purely additive follow-up — this design
doesn't block it.

### Proposed schema (`data/chomp.db`, created by `src/lib/chomp/db.ts`)

Same idempotent style as `src/lib/grains/db.ts:109-148`: one `CREATE TABLE IF NOT
EXISTS` block, additive columns guarded by `PRAGMA table_info`.

```sql
-- Every completed run. Append-only; the audit trail and the source of truth.
CREATE TABLE IF NOT EXISTS chomp_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vid           TEXT    NOT NULL,          -- from the signed grain_vid cookie
  score         INTEGER NOT NULL,
  level         INTEGER NOT NULL DEFAULT 1,
  pellets       INTEGER NOT NULL DEFAULT 0,  -- grains chomped
  power_used    INTEGER NOT NULL DEFAULT 0,  -- golden grains eaten
  pests_eaten   INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  ended         TEXT    NOT NULL DEFAULT 'death',  -- 'death' | 'cleared' | 'quit'
  country_code  TEXT,                       -- X-Country-Code, default 'XX'
  country_name  TEXT,                       -- X-Country-Name, default 'Unknown'
  ip_hash       TEXT,                       -- salted sha256, same helper as grains
  created_at    INTEGER NOT NULL            -- Date.now()
);
CREATE INDEX IF NOT EXISTS idx_chomp_runs_score   ON chomp_runs (score DESC);
CREATE INDEX IF NOT EXISTS idx_chomp_runs_created ON chomp_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chomp_runs_vid     ON chomp_runs (vid, score DESC);
CREATE INDEX IF NOT EXISTS idx_chomp_runs_iphash  ON chomp_runs (ip_hash, created_at DESC);

-- Denormalised best-per-player, so the board is ONE indexed read (mirrors how
-- getTopVisitors() reads visitors.total rather than aggregating).
CREATE TABLE IF NOT EXISTS chomp_players (
  vid           TEXT PRIMARY KEY,
  display_name  TEXT,                       -- NULL => fall back to playerHandle(vid)
  best_score    INTEGER NOT NULL DEFAULT 0,
  best_level    INTEGER NOT NULL DEFAULT 1,
  best_run_id   INTEGER,
  games         INTEGER NOT NULL DEFAULT 0,
  country_code  TEXT,
  country_name  TEXT,
  first_seen    INTEGER,
  last_seen     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chomp_players_best ON chomp_players (best_score DESC);

-- Per-country board. GeoIP is free on this vhost, and the grains game already
-- trains visitors to expect a country race.
CREATE TABLE IF NOT EXISTS chomp_countries (
  code        TEXT PRIMARY KEY,
  name        TEXT,
  best_score  INTEGER NOT NULL DEFAULT 0,
  best_vid    TEXT,
  total_score INTEGER NOT NULL DEFAULT 0,
  games       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chomp_countries_best ON chomp_countries (best_score DESC);
```

One `handle.transaction(...)` per submit writes all three tables, exactly like
`addGrains()`.

**On `display_name`:** `grains.db` already stores a chosen name per vid
(`visitors.display_name`), and the *same* `grain_vid` cookie identifies the player here.
Duplicating it into `chomp_players` means a player can have two different names on two
boards. Cross-reading it means an `ATTACH` (or moving both games into one file). See
open question 4.

---

## 7. Maze layout — 28 × 31, original, for review

This is the part I most want signed off before writing any engine code.

Legend — `#` wall · `.` grain (pellet) · `o` golden grain (power pellet) · space =
open, no grain · `=` pen gate.

```
      0         1         2
      0123456789012345678901234567
  0   ############################
  1   #............##............#
  2   #.####.#####.##.#####.####.#
  3   #o####.#####.##.#####.####o#
  4   #.####.#####.##.#####.####.#
  5   #..........................#
  6   #.####.##.########.##.####.#
  7   #.####.##.########.##.####.#
  8   #......##..........##......#
  9   ######.##.########.##.######
 10   ######.##.########.##.######
 11   ######.##.        .##.######
 12   ######.##.###==###.##.######
 13   ######.##.#      #.##.######
 14         .##.#      #.##.              <- WARP TUNNEL (both edges open)
 15   ######.##.#      #.##.######
 16   ######.##.########.##.######
 17   ######.##.########.##.######
 18   ######.##..........##.######        <- sub-pen loop corridor
 19   ######.##.########.##.######
 20   #............##............#
 21   #.####.#####.##.#####.####.#
 22   #.####.#####.##.#####.####.#
 23   #o...........##...........o#
 24   ####.##.############.##.####
 25   #.......##........##.......#
 26   #.#####.##.######.##.#####.#
 27   #.#####.##.######.##.#####.#
 28   #.#####.##.######.##.#####.#
 29   #..........................#
 30   ############################
```

> **Revision 2 (row 28).** The first draft had row 28 as
> `#..........######..........#`. Against row 29 (fully open) that made rows 28–29 a
> **2-tile-wide open room** on both sides — girth 4, eighteen 2×2 cycles. A maze-chase
> maze must be 1-wide corridors everywhere: a 2-wide region lets pests pass each other
> and lets the player sidestep, which breaks pursuit entirely. Row 28 now repeats row
> 27's pattern, leaving isolated single openings at cols 1, 7, 10, 17, 20, 26 that drop
> into the bottom corridor. This is the same construction the genre uses (a fully open
> bottom row fed by isolated gaps above it). Girth went 4 → 10.

**Machine-verified** (throwaway validators in the scratchpad, not in the repo):

```
walkable cells: 324 | pellets: 280 | power pellets: 4
pen interior cells: 18 (cols 11-16, rows 13-15)
dead ends (<=1 exit): none
unreachable from (1,1): none          [flood fill, warp-aware]
tunnel row 14 left/right edge: [" ", " "]
structural problems: none             [28x31, every row 28 wide, col x == col 27-x]
no 2x2 open blocks: confirmed         [every corridor exactly 1 tile wide]
```

### 7.1 Loop / kiting analysis

Player-traversable graph (pen interior and gate excluded — those are pest-only):

```
tiles V=304   edges E=325   independent loops (cycle rank) = 22
junction tiles (deg>=3): 38    corridor/corner tiles (deg==2): 266    dead ends: 0
GIRTH (shortest cycle): 10 tiles
loops with <2 entrances (free-win kite risk): 0
```

**Shortest cycle: 10 tiles** — the loop around the small wall block at rows 23–25,
cols 4–7 (and its mirror at cols 20–23). It has 5 junctions on it, so it is the most
heavily-pincered loop in the maze; you cannot hide there.

Every distinct minimal cycle, with how many junction tiles let a pest enter it, and the
longest blind run between two entrances:

| len | entrances | max blind run | region |
|---:|---:|---:|---|
| 10 | 5 | 2 | rows 23-25, cols 4-7 *(and mirror)* |
| 16 | 3 | 7 | rows 5-8, cols 1-6 *(and mirror)* |
| 16 | 3 | 10 | rows 20-23, cols 1-6 *(and mirror)* |
| 18 | 3 | 8 | rows 1-5, cols 1-6 *(and mirror)* |
| 18 | 4 | 10 | rows 20-23, cols 6-12 *(and mirror)* |
| 20 | 4 | 9 | rows 1-5, cols 6-12 *(and mirror)* |
| 20 | 3 | 12 | rows 25-29, cols 1-7 *(and mirror)* |
| 22 | **2** | **14** | rows 25-29, cols 10-17 |
| 24 | 6 | 8 | rows 5-8, cols 9-18 |
| 24 | 4 | 8 | rows 8-11, cols 9-18 |
| **32** | **4** | **8** | **rows 11-18, cols 9-18 — the pen loop** |
| 36 | 9 | 6 | rows 5-20, cols 6-9 *(and mirror)* |
| 44 | 8 | 12 | rows 14-20, cols 0-27 — **the warp loop** |
| 52 | 16 | 8 | rows 18-29, cols 6-21 |

**Can the loop be cut off? Yes — structurally, every loop can.**

- **No loop has fewer than 2 entrances.** A loop with a single entrance is the free-win
  case: pursuers all funnel in behind the player and queue up forever. There are none.
- **The pen loop (32 tiles) has 4 entrances, one at each corner** — `(11,9)`, `(11,18)`,
  `(18,18)`, `(18,9)` — which is the best possible pincer geometry: two pests entering
  at diagonally opposite corners split the loop into two 16-tile arcs with the player in
  one of them. Longest blind run is 8 tiles.
- **Pests are released onto the loop, not outside it.** The pen gate opens upward into
  row 11, cols 13–14, which sits in the middle of the loop's top edge. A player circling
  the pen runs into freshly-released pests rather than accumulating a tail behind them.
- **The weakest loop is the 22-tile one at rows 25–29, cols 10–17** — only 2 entrances,
  both on the bottom row at cols 10 and 17, with a 14-tile blind run over the top. Two
  pests taking the two entrances close it completely. I'm keeping it: it reads as a
  deliberate risk pocket, not an exploit.

**The honest caveat.** Geometry alone cannot make kiting impossible — it only makes it
*defeatable*. Whether a competent player can farm the pen loop is decided in Phase 3 by
the AI and the speed curve, and it needs three specific guarantees:

1. **The Sparrow must genuinely take the opposite arc.** Targeting 4 tiles ahead of the
   player's facing means that on a loop the shortest path to that target is usually the
   *other* way round — that is the whole anti-kite mechanism. If its junction tiebreak
   collapses to "follow the Rat", kiting works.
2. **Scatter mode must actually fire.** The periodic scatter/chase cycle breaks any
   stable orbit by pulling pests off the loop to their corners and then re-entering from
   new positions.
3. **Pest speed must stay close to player speed** (genre norm is pests at ~95–105% of
   the player, varying by level). If pests are much slower, a 32-tile loop with an 8-tile
   blind run is a free lap regardless of targeting.

I'll verify this empirically in Phase 3 by scripting a kiting bot against the finished
AI and measuring how many laps it survives; if the answer is "indefinitely", the fix is
AI/speed tuning first, and only then geometry.

**Design notes**

- **Mirror-symmetric** about the vertical axis: `row[x] === row[27-x]` for every cell,
  verified on all 31 rows. Not vertically symmetric — the bottom third is a distinct
  "paddy steps" pattern (rows 24–29) so the two halves of the maze don't read the same.
- **Warp tunnel** on row 14 only, both edges open. Cols 0–5 and 22–27 are deliberately
  **pellet-free** so the tunnel is an escape route, not a scoring lane. It feeds the
  col-6 / col-21 vertical shafts.
- **Central pen**: walls cols 10–17 rows 12–16, interior 6×3 (cols 11–16, rows 13–15) —
  room for four pests plus a spawn point. Gate `==` at row 12, cols 13–14. Ghosts exit
  **upward** into the row-11 corridor, which connects to the col-9 and col-18 shafts.
- **Four power pellets** at the classic-genre positions: rows 3 and 23, cols 1 and 26.
  All four sit on long vertical corridors, so grabbing one commits you to a route.
- **No dead ends anywhere** — every walkable cell has ≥2 exits, verified. There is no
  cell where a player can be cornered by geometry alone.
- **Row 18 is a deliberate loop.** The obvious layout puts a solid 8×4 block under the
  pen; I opened cols 10–17 at row 18 so the col-9 and col-18 shafts cross-connect. That
  turns the whole lower-middle from two parallel corridors into a genuine loop, which is
  what makes chase play readable.
- **The col-6 / col-21 shafts** (rows 9–19) are long, straight, and branch only at the
  tunnel. That is intentional and genre-correct: they are the high-risk / high-reward
  routes, and the tunnel is the payoff.
- 280 pellets + 4 power pellets = **284 collectables** per level.

**Not yet decided by this layout:** player spawn point (proposal: row 23, col 13/14 area
— just under the pen, on the wide corridor), pest scatter targets (proposal: the four
corners, rows 1/29 × cols 1/26), and fruit/bonus spawn (proposal: row 17-ish centre,
but that's a wall right now — needs a tweak or a different spot if we want fruit).

---

## 8. Open questions

1. **Where is `docs/rice-chomp-spec.md`?** It is not in the repo or anywhere under
   `/home/deploy`. Should I proceed from the brief in your message, or do you want to
   drop the spec in first? Pest personalities, the scoring table, the level/speed curve
   and the art direction are all things I've had to guess or defer below.

2. **Route path:** `/chomp`, `/rice-chomp`, or nested under `/play`? I've assumed
   `/chomp` (matches the flat, short existing routes: `/play`, `/pfp`, `/memes`). And
   should it appear in the site menu (`src/config/home.ts` `homeNavLinks`) or stay a
   hidden easter egg like `/play`?

3. **One database or two?** My plan is a separate `data/chomp.db` so the grains
   single-writer contract stays clean. The alternative is new tables inside the existing
   `grains.db`, which lets the leaderboard read `visitors.display_name` directly but
   makes the Next process a second writer to a file the WS server owns. I recommend
   two files. Confirm?

4. **Player identity and name.** Reuse the existing `grain_vid` cookie + the name the
   player already chose on the grains leaderboard, or a fresh arcade-style name entry
   (3 initials) per RICE CHOMP? Reusing the vid is nearly free; sharing the *name*
   across both games needs question 3 resolved first.

5. **How much anti-cheat do you actually want?** This is the biggest fork in the road:
   - **(a) Parity with grains** — trust the client, clamp the rate. Cheap, ~1 day.
     A leaderboard anyone can fake with `curl`.
   - **(b) Server-side plausibility** — reject runs where score exceeds the theoretical
     max for the reported level/duration/pellets, cap runs per vid per minute, cap per
     IP hash. A few hours on top of (a). Stops casuals, not a determined attacker.
   - **(c) Input-trace replay** — the client submits the seeded input log, the server
     re-simulates the run with the same deterministic engine and computes the score
     itself. This is the only option that genuinely works. It requires the engine to be
     fully deterministic (fixed timestep, seeded RNG, no float drift) and to run in
     Node — which is a real design constraint I'd need to build in from day one, not
     retrofit. Several days.

     **I'd recommend (b) now with the engine written deterministically so (c) stays
     open.** Your call.

6. **Per-country leaderboard as well as global?** GeoIP is free on this vhost and the
   grains game already trains visitors to expect a country race. Costs one extra table.

7. **`prefers-reduced-motion` policy.** `GrainCatch` disables gameplay outright under
   reduced motion. For RICE CHOMP, do you want (a) the same — a "needs motion" notice,
   (b) playable with flashing/shake/particles stripped but the maze still animating, or
   (c) ignore the preference for this route since it's opt-in gameplay? I'd pick (b).

8. **Mobile input:** swipe-to-turn, an on-screen d-pad, or both? And on a portrait
   phone, should the 28×31 maze letterbox with a HUD above/below, or rotate to
   landscape? There is no touch-control precedent in the repo, so this is all new.

9. **May I fix `globals.css:293` while I'm in here?** It's a live 404 —
   `/onegrainofrice/grains/chopstick-cursor.svg` should be `/grains/…` under the
   production basePath of `""`. One line, affects the existing grains game, not RICE
   CHOMP. Separate commit, or leave it alone?

10. **Art and sound.** Everything on canvas today is drawn procedurally (`riceBowlEngine`
    paints grains with `ctx.ellipse` and prebakes to offscreen canvases). Do you want
    RICE CHOMP the same way, or sprite art in `public/chomp/`? And for SFX — reuse
    `src/lib/sound.ts` + the existing `SoundToggle`, and should I extend
    `scripts/gen-sfx.mjs` to generate chomp/death/power sounds?

11. **The four pests.** Absent the spec: names, look, and AI personality. Genre-standard
    is direct-chase / ambush-ahead / flanking-vector / shy-scatter. A rice-field reading
    would be e.g. weevil, planthopper, field rat, sparrow. Do you have names and
    personalities already, or should I propose a set?
