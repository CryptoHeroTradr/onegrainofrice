# RICE CHOMP — recon & build plan

**Status (2026-08-05): PHASE 7 IS IN. THE GAME NOW LIVES AT `/games/chomp`.**
The site's information architecture changed around the finished game: `/` is the home
page, the three games moved under a new `/games` index, and the menu carries one 🎮 Games
entry instead of a direct Rice Chomp link. **Nothing about the game itself changed** — no
engine edit, no component edit beyond one link constant. What did change is the thing this
phase existed to get right: `src/lib/playSurfaces.ts` moved in the same commit as the
route, so the translate script did not come back and the ambient decorations did not
return to the board. `test/play-surfaces.test.ts` is new and makes the next such move
noisy instead of silent. **348 tests pass, typecheck and lint clean, `/games/chomp` still
prerenders static.** Details in §11; the spec's new *Route and information architecture*
section is authoritative on the scheme.

**Status (2026-08-05): PHASE 6 IS IN, AND THE GAME IS FEATURE-COMPLETE against the spec.**
The leaderboard — **ONE board: the top 50 players by best single run, with the player's
country flag as a column** — is built on `data/chomp.db` behind `/api/chomp/*`, with the
Next process as its sole writer and the grains WS single-writer contract untouched. New files:
`src/lib/chomp/{env,db,score,trace,wire,grainsName}.ts`,
`src/app/api/chomp/{leaderboard,score}/route.ts`,
`src/components/chomp/{ChompLeaderboard,ChompSubmit}.tsx` and
`src/components/chomp/leaderboard.ts`, plus `test/chomp-score.test.ts` and
`test/chomp-db.test.ts`. One line went into the engine (`bonusesEaten`, a run-total
counter nothing in the simulation reads) and one private function moved out of the grains
board into `@/lib/grains/flag`, where it stays. Measurements — what the panel costs the
board at eight viewports, the two bugs the measuring found, and the end-to-end submission
smoke — are in §10. **339 tests pass, typecheck and lint are clean, `/chomp` still
prerenders static, and the page still makes zero third-party requests.**

**Amendment, 2026-08-05, same day: THE SECOND BOARD IS GONE.** Phase 6 shipped two boards
— top players and top countries — and Lito cut it to one within hours: top 50 players,
country flag as a column beside the name. Removed, not disabled: `getTopCountries()`, the
`chomp_countries` table and its index, `countryRank()`, `WireCountry`, the response's
`countries` and `yourCode`, the panel's tab strip, and one of the two HUD buttons. GeoIP
capture on submission STAYS — it is what feeds the flag. Ranking was already best-run-per-
player and remains so. Nothing about the panel changed: same docked/overlay forms, same
pause rule, same gutter sizing, same validation. §6's schema and §10's measurements below
are marked where the removal overtook them; the spec's Leaderboard section is amended to
match.

**Status (2026-08-04):** Phase 5 is in. `src/components/chomp/` holds `ChompScreen.tsx`,
`ChompCanvas.tsx`, `BonusIcons.tsx`, `PestPortrait.tsx`, `TouchControls.tsx`,
`ChompAttract.tsx`, `ChompPause.tsx`, `ChompGameOver.tsx`, `ChompSettings.tsx`,
`prefs.ts`, `scores.ts` and `engine/{game,levels,maze,pests,render,types,cues}.ts` — the
maze, the player grain, the four pests, the scatter/chase cycle, the pen, frightened mode,
lives and death, cornering, the per-level difficulty curve, level completion with the maze
flash, the six bonus items, the two interstitials, and now eight synthesized sound cues,
the attract/pause/game-over screens, swipe and an optional d-pad, reduced motion and the
high-contrast board. `levels.ts` holds every tuning number. Tests:
`test/chomp-{maze,movement,pests,cornering,levels,kiting,difficulty,audio}.test.ts` plus
`test/chomp-support.ts` (the bot). Sections 1–6 below are recon and remain accurate; §7
carries the Phase 3 and Phase 4 measurements. Still to come: **the leaderboard, and only
the leaderboard.**

**Phase 5.5 (the visual upgrade) is in, 2026-08-04.** Five changes: the centre pit is a row
taller (§7 Revision 4 — no player-reachable tile moved, so no maze property changed); the
walls carry the paddy texture; the pit holds a looping video, composited through the canvas
rather than a DOM layer; "One Grain of / $RICE" is baked into the two wall blocks above the
pit; and the HUD spends a rice grain per life instead of a `◆`. `public/chomp/` now exists
and holds the game's only two static assets, 316 KB of a 500 KB budget. New file:
`src/components/chomp/LivesRow.tsx`. Measurements in §8; the board treatment itself is
described in the spec's *The board*, which is no longer a brief.

**Phase 5.6 (the page around the board) is in, 2026-08-04.** Three changes, no engine
change: the site's nav bar is mounted on `/chomp` in a play-surface form (in flow, solid,
56px, no language control, hidden on a landscape phone); the route's text runs off a fluid
`--text-chomp-*` ramp in `globals.css` so it grows on a large monitor instead of staying
phone-sized; and "back to the rice paddy" is a button in a gutter beside the board on wide
landscape viewports, collapsing into the header link everywhere else. Measurements — what
the chrome costs the board at seven viewports, two bugs the measuring found, and the
answer to "is the type problem site-wide" (it is) — are in §9. `JourneyNav` is now the
FIFTH consumer of `src/lib/playSurfaces.ts`.

> **`docs/rice-chomp-spec.md` exists and is authoritative.** The ⚠️ banner that used to sit
> here said it was missing; that was true only on the day this plan was written. Where the
> spec and this plan disagree, **the spec wins** — it is the living document and is amended
> in the same commit as any decision that supersedes it.

---

## 0. How we work

Read this section and `docs/rice-chomp-spec.md` at the start of every phase. These two
files are the durable context; the chat log is not.

- **Fresh session per phase.** Each phase begins with `/clear`, not a carried-forward
  conversation. `/compact` mid-phase if one runs long. Anything from a session that a
  later phase needs goes into these two files *before* the clear — if it is not written
  down here, it does not survive.
- **No visual-proof artifacts. Do not use the `artifact-design` skill on this project.**
  The preview server is running and the owner can see the game directly; building a
  separate interactive harness to demonstrate something already visible in the running
  game is the most expensive habit available and it buys nothing. When something static
  genuinely has to be shown: a plain HTML file, no skill, no design system, under ~100
  lines, served on the preview port — or just say which screen to look at.
- **Watch the context window.** Long contexts dominate cost. Prefer targeted reads over
  re-reading whole files, and end phases rather than letting them sprawl.
- **Cheap model for mechanical implementation.** Reserve the expensive model for design
  and architecture decisions. If a heavy skill must run at all, scope it down or pin a
  cheaper model in its frontmatter.

### The preview server

`http://127.0.0.1:3099` — a **production build**, not `next dev`.

> **START IT WITH `deploy/preview.sh <build-id>`, NOT BY HAND.** *Added 2026-08-05,
> after the second stale preview and the fifth instrument failure on this project.*
> The script exists because starting it by hand has now silently produced wrong
> measurements twice, in the same way both times: a `next start` left on :3099 keeps
> serving a build directory that has since been **deleted**, because Next holds its
> file descriptors open. The port answers 200, the page looks correct, and every
> number taken off it describes a build that no longer exists.
>
> Two things the script does that hand-starting did not:
> - **It finds the holder with `ss`, not `lsof`.** `lsof -ti:3099` printed nothing
>   on both occasions, so the kill was a silent no-op;
>   `ss -lptn 'sport = :3099'` found the pid immediately.
> - **It prints the build stamp read back OFF THE RUNNING SERVER** and compares it
>   to the one requested — `MATCH ✓` or `MISMATCH ✗ DO NOT TRUST ANY MEASUREMENT
>   FROM THIS PORT`. The extraction is generic (it reads whatever `?v=` stamp the
>   server is using, via `asset()`), deliberately: grepping for the EXPECTED stamp
>   would come back empty against a stale build and report "could not read", which
>   is a much weaker statement than naming the wrong value.
>
> Both paths were verified against a real reproduction — a preview started outside
> the script, its build directory deleted underneath it, then the script run for a
> different build. It found the stale holder, killed it, started the right build and
> confirmed the stamp.
>
> It also sets `CHOMP_DB_PATH` to a scratch file for you, which is the §10.4 trap
> below. **If a future session cannot say which build it is measuring, none of its
> numbers mean anything.**

> **AND `CHOMP_DB_PATH=<somewhere else>`, since Phase 6.** It defaults to
> `<cwd>/data/chomp.db`, which is the file the live process on :3006 owns — so a preview
> started without it is a second writer of the leaderboard database, which is exactly what
> the two-database design exists to prevent. Pointing it at a scratch path also means
> preview submissions do not land on the real board. See §10.4.
>
> > **This is now ENFORCED rather than remembered.** *2026-08-05, after Phase 7.* A
> > process that does not set `CHOMP_DB_PATH` and has not declared `CHOMP_DB_OWNER=1`
> > is **refused the default path outright** — `getChompEnv()` throws with a message
> > naming both fixes, and no file is created. The flag is declared in
> > `ecosystem.config.js`'s env block for `onegrainofrice` and must never move to
> > `.env.local`, which the preview shares. `test/chomp-db-ownership.test.ts` pins all
> > of it, including that the flag appears exactly once in the pm2 config and not at
> > all in `.env.local`. `deploy/preview.sh` sets a scratch path for you.

It does **not** hot-reload. To show a change
there, build a new dist and restart it against the new sha. It is separate from pm2 and
from live; restarting it never touches production. Live deploy is still
`deploy/build.sh` then `deploy/promote.sh <sha>` — see the deploy notes in §3.

---

## 1. Routing and build

### 1.1 basePath — the live value is `""`, not `/onegrainofrice`

`next.config.ts:12`:

```ts
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";   // <- the fallback is "" TODAY
```

> **Stale as written, corrected 2026-08-05 (Phase 7).** This section was recorded when
> the fallback was `"/onegrainofrice"`, and the paragraphs below argue at length that the
> fallback is not what production uses. That argument is now moot: the default was changed
> to `""` at some point after Phase 1, so source and production agree. The reasoning is
> kept because the *conclusion* is unchanged and still load-bearing — **never hardcode
> either prefix** — but do not go looking for a `/onegrainofrice` default in
> `next.config.ts`, because it is not there.

The `??` fallback is what you see everywhere in the source, but **it was not what
production used.** `.env.local` sets `NEXT_PUBLIC_BASE_PATH=""` ("Serve at the domain
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

Existing routes *(as of Phase 7, 2026-08-05)*: `/` (the home page,
`src/app/page.tsx`), `/games`, `/games/chomp`, `/games/grains`, `/games/catch`, `/memes`,
`/pfp`, `/charity`, `/dca`, `/tma`, `/classic`, plus `src/app/grains/session/route.ts`
and nineteen handlers under `src/app/api/`. `/home`, `/chomp` and `/play` are 308
redirects, not pages — see §11.

*Before Phase 7 this read: `/` (the Grains Game), `/home`, `/memes`, `/pfp`, `/charity`,
`/dca`, `/tma`, `/classic`, `/play`. The three games were at `/`, `/chomp` and `/play`.*

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
from `x-country-code`. The `/games/chomp` page **is** covered by it; that's harmless.

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
`POST {score: 999999}` would be strictly weaker than what grains has today.

> **Answered in Phase 6** (open question 5): server-side plausibility, with the input
> trace stored so replay verification stays a later server-only change. `POST {score:
> 999999}` is refused with a 422 — measured, §10.3. Two of the gaps listed above are
> inherited rather than fixed, and are named as such in `src/lib/chomp/score.ts`: the
> session route still mints identities freely, so the per-vid rate limit is a speed bump
> and the per-IP-hash limit is the real bound.

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

- A page at `/games/chomp` (was `/chomp`) → served by the existing `location /` → :3006. No nginx change.
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
   fight `instances: 1`, and must not add a second writer to `grains.db`. *Held in Phase
   6: `chomp.db` is a second file with a second single writer, and the only touch of
   `grains.db` is a `readonly: true` connection. But note the corollary the phase
   discovered — the SAME hazard now exists for `chomp.db`, because the preview server
   defaults to the same path the live process uses. See §10.4.*
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

2. ~~**The SQLite WAL is not checkpointing.**~~ **Withdrawn — measured, and it is fine.**

   The raw numbers looked alarming:

   ```
   grains.db      143 KB
   grains.db-wal  4.1 MB     <- 29× the database
   ```

   But 4.1 MB is not a leak, it is the default cap. Measured on the live DB:

   ```
   page_size 4096 | journal_mode wal | wal_autocheckpoint 1000 pages
   threshold = 32 + 1000 * (4096 + 24) = 4,120,032 bytes
   actual    = 4,140,632 bytes = 1005 frames
   ```

   The WAL is sitting one thousand frames deep because that is exactly where SQLite's
   default `wal_autocheckpoint` lets it sit. It checkpoints on schedule and reuses the
   space; the file stays around 4 MB forever rather than growing. Nothing to fix, and
   no reason to go near the process that owns it.

   The one thing worth carrying forward is a deliberate choice for `chomp.db` rather
   than an inherited default: set `wal_autocheckpoint` explicitly at open time so the
   ceiling is a decision on the record instead of a surprise later.

3. **`onegrainofrice` has restarted 31 times in 37 hours** (`pm2 list` ↺ column) while
   `oneg-grains-ws` has 0 restarts in 17 days. Some of those are deploys, but 31 is a
   lot — could be `max_memory_restart: 512M` firing. A memory-hungry canvas game on the
   same process makes this worse. Worth checking `pm2 logs onegrainofrice --err` before
   Phase 2.

4. ~~**`/chomp` makes one third-party request, and it is Google Translate.**~~
   **Found and fixed 2026-08-04, Phase 5**, measuring the spec's "zero third-party
   network requests" acceptance criterion against a real build.

   ```
   $ curl -s http://127.0.0.1:3099/chomp | grep -oE 'https?://[a-z0-9.-]+' | sort -u
   https://1grainofrice.com          <- own canonical URL, not a request
   https://translate.google.com      <- the violation
   ```

   `layout.tsx` mounts `TranslateProvider` site-wide and it loaded
   `translate.google.com/translate_a/element.js`. It was the ONLY external host on the
   page, it was in the Phase 4 build too (so Phase 5 did not introduce it), and nothing
   in the game asked for it.

   Fixed by scoping it off play surfaces through `src/lib/playSurfaces.ts` — the same
   one-line rule `ChopstickCursor`, `KonamiRice` and `RiceParticles` already use, and
   the reason that list exists rather than three private copies of an array. It needed
   one wrinkle the other three did not: this provider wraps the whole app, so it cannot
   return null. On a play surface it renders its children with the inert NOOP context
   and skips the script, the widget mount point and the cookie effects.

   Re-measured after the change: `/chomp` has no external host at all, and `/home`,
   `/`, `/play` and `/pfp` still load the widget. **Four global providers are now
   caught by the same rule, and the spec's Hard Constraints carry a standing line that
   every new site-wide provider gets checked against it** — nobody finds these by
   reading `layout.tsx`, they find them by building a page and measuring it.

   Note `/play` (GrainCatch) still gets the widget. It is a game too, but it has no
   zero-third-party criterion and adding it to the list would change a shipped game's
   behaviour for no stated requirement. Left alone on purpose; it is a one-line
   addition if it is ever wanted.

   > **Re-affirmed, and upgraded from "left alone" to "must not", 2026-08-05, Phase 7.**
   > That route is `/games/catch` now, and the phase brief asked for every game route to
   > go on the list. It must not: **you catch the grains WITH the chopstick cursor**, so
   > scoping the ambient decoration off that page deletes the game's controller. The same
   > goes for `/games/grains`, which has a custom cursor of its own in `globals.css`. The
   > "one-line addition if it is ever wanted" above reads as an invitation and is now
   > qualified — it was only ever about the *translate widget*, not about the whole list.
   > See §11.3 and the spec's *Route and information architecture*.

5. **`src/lib/highscore.ts` is a module-level variable on the server.** In a single fork
   process it happens to behave like a global shared across all users; the doc comment
   claims "session-only … resets on reload", which is only true because the client reads
   it at render. It is not a per-user store. Not used by RICE CHOMP, but don't copy it.

---

## 5. Proposed file tree

Corrected against the real conventions above (thin `page.tsx` → `"use client"` screen →
directive-free engine modules → server-only `src/lib/<domain>/`).

> **Where Phase 5 diverged, and why.** `TouchControls.tsx` is the d-pad ONLY — the swipe
> surface ended up on `ChompCanvas`'s own wrapper, because a swipe has to work over the
> letterbox bars as well as the board and putting it on a sibling component would have
> meant a second element stacked over the canvas fighting it for pointer capture. The
> screen also grew four small siblings the proposal did not anticipate —
> `ChompAttract.tsx`, `ChompPause.tsx`, `ChompGameOver.tsx`, `ChompSettings.tsx`, plus
> `PestPortrait.tsx`, `prefs.ts` and `scores.ts` — rather than piling every overlay into
> `ChompScreen.tsx`, which is the same split `grains/` uses for its HUD parts.
> `engine/sprites.ts` never appeared: the prebake lives in `render.ts` alongside the art
> it bakes. `engine/cues.ts` is new and is discussed in the spec's Sound section.

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
src/components/chomp/ChompLeaderboard.tsx    "use client" — THE board (one), in two forms
                                             (docked panel / overlay). reuses @/lib/grains/flag;
                                             see its header for what it reuses and what it
                                             deliberately does not

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
src/lib/chomp/trace.ts                       [Phase 6] the compressed input trace codec.
                                             isomorphic + pure: browser encodes, route decodes
src/lib/chomp/wire.ts                        [Phase 6] types only — the shapes that cross
                                             the wire, imported by both ends
src/lib/chomp/grainsName.ts                  [Phase 6] the ONE read of grains.db, readonly
src/components/chomp/leaderboard.ts          [Phase 6] host side: summarizeRun(), the three
                                             calls, the in-flight request share
src/components/chomp/ChompSubmit.tsx         [Phase 6] name entry on the game-over card

test/chomp-maze.test.ts                      28x31, symmetry, full connectivity, no dead ends,
                                             pellet count, tunnel wrap
test/chomp-pests.test.ts                     targeting math (pure fns) per personality
test/chomp-score.test.ts                     score validator accepts/rejects the right runs
test/chomp-db.test.ts                        [2026-08-05] the write path against a throwaway
                                             SQLite file: two tables, best-run-per-player,
                                             dedupe no-op, flag column
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

> **What shipped: `no-store`, but NO interval polling.** *Amended 2026-08-05, Phase 6.*
> The board is fetched when the panel opens and when its Refresh button is pressed, and
> that is all. A timer would poll hardest in exactly the case where the panel is a docked
> side panel beside a running game at 60fps, to animate a number nobody is watching
> change. There is a manual Refresh instead, which is honest about what it does. The
> follow-up to a genuinely live board is unchanged and still purely additive.

### Proposed schema (`data/chomp.db`, created by `src/lib/chomp/db.ts`)

Same idempotent style as `src/lib/grains/db.ts:109-148`: one `CREATE TABLE IF NOT
EXISTS` block, additive columns guarded by `PRAGMA table_info`.

> **What shipped, and where it differs from the sketch below.** *Amended 2026-08-05,
> Phase 6.* The shape is as proposed; five columns were added and one was derived rather
> than accepted.
>
> - **`chomp_runs` gained `name`, `seed`, `ticks`, `trace` and `trace_hash`.** The trace
>   column is the one the sketch could not do without and did not list — "store the input
>   trace unverified" has to land somewhere. `seed` travels because replay verification
>   needs it, even though every run uses `DEFAULT_SEED` today.
> - **`duration_ms` is DERIVED, not submitted.** The payload carries simulation `ticks`
>   and the row stores `ticks × 1000 / 60`. A client-supplied wall-clock duration would
>   have been a second forgeable field saying the same thing as the first, and the tick
>   count is the authoritative clock.
> - **`UNIQUE INDEX idx_chomp_runs_dedupe ON (vid, trace_hash)`** makes submit-once a
>   database property rather than a check somebody can forget to run. A double-click or a
>   retry after a dropped response is a no-op that reports the truth.
> - ~~**`chomp_countries` gained `best_name`**~~ — **and then `chomp_countries` went.**
>   *Amended again 2026-08-05, hours later: the country board was removed and the table
>   with it.* The sketch below still shows it; treat that block as struck. **Nothing
>   creates it, nothing reads it, nothing writes it, and production never had it** —
>   `data/chomp.db` did not exist yet when it was cut, so there is no migration to
>   write and nothing to drop. A dev database made in that window keeps an orphan copy,
>   inert; delete the file or drop the table by hand. The rule the table carried — rank
>   on a BEST run, never on a sum, because a sum ranks whoever played most and is the
>   one number a script can inflate without ever needing a good run — was never only
>   about countries and still governs `chomp_players`.
> - `idx_chomp_runs_vid` is `(vid, created_at DESC)` rather than `(vid, score DESC)`,
>   because what actually reads it is the rate limiter.
> - **`chomp_players.country_code` outlived the country board and is now the flag
>   column.** It is written from nginx's GeoIP headers on submission and read straight
>   back out by `getTopPlayers()`; no join, no second table, no extra query.
>
> **Nothing in the schema or the dedupe index ever assumed two boards.** `chomp_runs` is
> the append-only audit trail and `idx_chomp_runs_dedupe (vid, trace_hash)` is about one
> player re-posting one run — neither has any notion of how many boards read them.
> `chomp_players` is the board and always was. The country board was a third table
> derived from the same writes, and removing it removed exactly itself.

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

-- ── STRUCK 2026-08-05: THIS TABLE DOES NOT EXIST. ────────────────────────────
-- The country board was removed the day it shipped and the table went with it.
-- Kept here only so the sketch reads as it was written; see the amendment above.
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

One `handle.transaction(...)` per submit writes all the tables at once, exactly like
`addGrains()`. *That was three tables as shipped and is two since the country board was
removed; the transaction is the point, not the count.*

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
 16   ######.##.#      #.##.######        <- Revision 4: was wall; the pit is 6x4
 17   ######.##.########.##.######
 18   ######.##..........##.######        <- sub-pen loop corridor
 19   ######.##.########.##.######
 20   #............##............#
 21   #.####.#####.##.#####.####.#
 22   #.####.#####.##.#####.####.#
 23   #o...........##...........o#
 24   ####.##.##.######.##.##.####        <- cols 10, 17: the spawn pocket's lateral exits
 25   #.......##........##.......#
 26   #.#####.##.######.##.#####.#
 27   #.#####.##.######.##.#####.#
 28   #.#####.##.######.##.#####.#
 29   #..........................#
 30   ############################
```

> **Revision 3 (row 24), 2026-08-04 — Phase 3, and the reason the kiting bot was built.**
> Row 24 was `####.##.############.##.####`, which left the bottom-centre room — row 25
> cols 10–17, the two shafts under it, and the stretch of row 29 they land on — with
> **exactly two ways out, both on row 29**. Every corridor here is one tile wide, so a pest
> standing on a way out is a closed door, and two pests shut the room completely. The
> player **spawns in that room**. Measured, not argued: two pests parked on the two exits
> killed a competent bot inside a second with no move that survived, and over a long
> unassisted run the live AI covered both exits about **1.5% of ticks** by accident.
> Opening `(10,24)` and `(17,24)` takes it from two exits to four, upward into the row-23
> corridor. Re-verified after the change: girth still 10, still no 2×2 open block outside
> the pen, still no dead ends, still mirror-symmetric, still fully connected. Two pests no
> longer seal it; four still do, which is the point — it stays a risk pocket.
>
> Not done sideways along row 25 (cols 8–9 and 18–19), which is the more literal reading of
> "a lateral exit": that fuses the three bottom rooms into one full-width corridor directly
> above the full-width row 29, joined by six shafts. That is a ladder, and a ladder is the
> most kiteable shape there is — the opposite of what the change is for.

> **Revision 2 (row 28).** The first draft had row 28 as
> `#..........######..........#`. Against row 29 (fully open) that made rows 28–29 a
> **2-tile-wide open room** on both sides — girth 4, eighteen 2×2 cycles. A maze-chase
> maze must be 1-wide corridors everywhere: a 2-wide region lets pests pass each other
> and lets the player sidestep, which breaks pursuit entirely. Row 28 now repeats row
> 27's pattern, leaving isolated single openings at cols 1, 7, 10, 17, 20, 26 that drop
> into the bottom corridor. This is the same construction the genre uses (a fully open
> bottom row fed by isolated gaps above it). Girth went 4 → 10.
>
> **Re-audited 2026-08-04**, because the girth-4 that triggered this change and the girth-4
> that turned out to be the pen artifact are the same number, and 14 grains is too much to
> spend on a measurement bug. Re-measured the counterfactual maze — draft row 28, row 24 as
> it stood at the time — scoped to player-**reachable** tiles only, i.e. with the artifact
> already excluded:
>
> | maze | row 24 | reachable cells | grains + power | girth | 2×2 blocks |
> |---|---|---:|---:|---:|---:|
> | draft row 28 | pre-amendment | 318 | 298 | **4** | **18**, all at rows 28–29 |
> | shipped row 28 | pre-amendment | 304 | 284 | **10** | 0 |
> | draft row 28 | current | 320 | 300 | **4** | **18**, all at rows 28–29 |
> | shipped row 28 | current | 306 | 286 | **10** | 0 |
>
> *Corrected 2026-08-04, second pass: the first version of this table had two rows measured
> against **different** row 24s — draft against the pre-amendment row 24, shipped against
> the current one — which made the cost read as 12. Both row-24 states are given now, and
> the cost is 14 either way. A table whose rows are not the same experiment is worse than
> no table.*
>
> The room was real. The 18 blocks run `(1,28)…(9,28)` and their mirror — the bottom two
> rows, nowhere near the pen — and the pen artifact cannot produce them: filtering to
> reachable tiles removes the pen's own 12 blocks (rows 11–14, cols 11–15) entirely, and
> the 18 survive that filter. The two findings coincide in the number and in nothing else.
> Cost confirmed at exactly 14 grains against a fixed row 24 (298 → 284, or 300 → 286), and
> it bought girth 4 → 10.

> **Revision 4 (row 16), 2026-08-04 — Phase 5.5. The pit is a row taller, and it is not a
> maze change.** Row 16 was `######.##.########.##.######`; cols 11–16 are now floor, so the
> pen interior is 6×4 over rows 13–16 and the wall band below it went from two rows (16, 17)
> to one (17). The reason is presentational — the pit is about to hold a backdrop image and
> a 6×3 rect was not worth looking at — but a change to the maze constant deserves the full
> audit whatever the reason, so it got one.
>
> **The six tiles that changed were wall enclosed on every side by the pen's own walls**
> (cols 10 and 17, and row 17 beneath). They therefore joined the sealed pen room, not the
> corridor network, and the player-reachable graph is identical tile for tile:
>
> | measured over reachable tiles | before | after |
> |---|---:|---:|
> | grains + golden | 282 + 4 | **282 + 4** |
> | reachable from spawn / player tiles | 306 / 306 | **306 / 306** |
> | girth | 10 | **10** |
> | 2×2 open blocks outside the pen | 0 | **0** |
> | dead ends | 0 | **0** |
> | spawn-pocket ways out | 4 | **4** |
> | mirror symmetry | yes | **yes** |
> | pen interior cells | 18 | 24 |
> | pest-walkable / pest-reachable | 326 / 326 | 332 / 332 |
> | eyes' BFS route field cells | 306 | **306** |
>
> **No grain count changed, so no test with a hardcoded count needed updating** — the tiles
> were wall, not grain. Three hardcoded pen bounds in `test/chomp-maze.test.ts` moved from
> row 15 to row 16 (`inPen`, `inPenBlock`, and the seal test's loop), and `PEN_BOTTOM` went
> 15 → 16. Nothing else in the engine reads the pen's extent: the renderer is grid-driven,
> the eyes' field is built pen-blind so it never saw the new tiles, and the pen state
> machine is keyed on `PEN_LANE_ROW` and `PEN_ENTRY_ROW`, which did not move.
>
> **The pit grew downward on purpose.** `PEN_LANE_ROW` stays at 14, so a pest's glide from
> its slot to the gate is the same distance and the staggered release keeps its exact tick
> timing; the new row is headroom below the pests, which is where a backdrop wants it.
> Growing the pit upward would have moved the gate, and the gate's row is what every exit
> timing and the eyes' BFS target are measured from. Gate (row 12, cols 13–14), the release
> corridor (row 11), player spawn (row 25), the four scatter corners and the bonus tile
> (row 18) are all unmoved — row 18 is still the first open corridor below the pen, now one
> wall row beneath it instead of two.
>
> **Both bots agree to the tick.** The kiting bot and the clearing bot were re-run at levels
> 1, 5 and 9 against the old and new maze in the same session; every figure is identical,
> which is the strongest available evidence that the simulation did not change:
>
> ```
> KITING BOT (power disarmed, board stripped)        old maze      new maze
>   L1  died 18.0s   | 2× lookahead 40.3s              same          same
>   L5  died 23.0s   | 2× lookahead 81.5s              same          same
>   L9  died 10.4s   | 2× lookahead  8.3s              same          same
> CLEARING BOT (seed 1000)
>   L1  CLEARED 282/282 grains, 66.4s, 1 life left     same          same
>   L5  CLEARED 282/282 grains, 68.3s, 1 life left     same          same
>   L9  not cleared, 252/282, 53.4s, 0 lives left      same          same
> ```
>
> Level 1 is still completable — the acceptance criterion — and `test/chomp-difficulty.test.ts`
> still clears it on all six seeds. Level 9 not falling to the clearing bot is the curve
> working and is not a criterion; only level 1 is. No stored input trace or replay fixture
> exists to invalidate: the one "recorded trace" test (`test/chomp-movement.test.ts`) builds
> its trace in-process and replays it in the same run, and there are no non-`.ts` files under
> `test/`.

**Machine-verified** (re-measured 2026-08-04 after the row-16 revision; the girth and 2×2
checks are now committed tests in `test/chomp-maze.test.ts` rather than scratchpad scripts):

```
player-walkable cells: 330 | reachable by the player: 306 | grains: 282 | golden: 4
pen interior cells: 24 (cols 11-16, rows 13-16) — open floor, sealed behind the gate
dead ends (<=1 exit): none
unreachable from spawn: only the 24 pen cells   [flood fill, warp-aware]
pest graph: 332/332 reachable                   [gate passable]
tunnel row 14 left/right edge: [" ", " "]
structural problems: none                       [28x31, every row 28 wide, col x == col 27-x]
2x2 open blocks outside the pen: none           [every corridor exactly 1 tile wide]
girth (shortest cycle): 10
spawn-pocket ways out: 4                        [was 2 — see Revision 3]
```

> **Scope the measurement to REACHABLE tiles.** The first run of the validator included the
> pen interior in the player graph and reported girth 4, ten 2×2 blocks and a cycle rank of
> 32. All of those were the pen's own 6×4 room — a room the player can never enter. The
> numbers above, and the committed tests, are over tiles reachable from the spawn.

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
- ~~**The weakest loop is the 22-tile one at rows 25–29, cols 10–17** — only 2 entrances,
  both on the bottom row at cols 10 and 17, with a 14-tile blind run over the top. Two
  pests taking the two entrances close it completely. I'm keeping it: it reads as a
  deliberate risk pocket, not an exploit.~~ **Wrong, and fixed 2026-08-04.** Keeping it was
  a mistake for a reason the analysis missed: *the player spawns inside it*. A risk pocket
  you choose to enter is a design; a risk pocket you are placed in at the start of every
  life, which two wandering pests can shut, is a death trap. It now has four entrances —
  see Revision 3 and §7.2.

### 7.2 The Phase 3 answer — measured, 2026-08-04

The caveat below was written before the AI existed and asked for empirical verification.
Here it is. `test/chomp-support.ts` holds a bot with a breadth-first danger field that
decides one tile ahead (so it corners like a person) and runs wherever it can still reach
the most maze before the pests cut it off. `test/chomp-kiting.test.ts` runs it against the
finished AI with **golden grains disarmed** — a power window is the answer to kiting, not
kiting — and a five-minute budget.

**Can a competent player kite all four pests indefinitely around any loop? No.**

| strategy | result |
|---|---|
| blind orbit, pen loop (32 tiles) | dead in **0.2 s**, 0 laps — it emerges into the pests' own doorway |
| blind orbit, spawn pocket (22 tiles) | dead in **13 s**, 5 laps |
| blind orbit, bottom-right ring (girth 10) | dead in **11 s**, 10 laps |
| adaptive bot, cleared board, from four starts | dead in **3.5 s – 103 s** |
| adaptive bot, grains down (chomp freeze in play) | dead in **49 s**; best observed **141 s** |
| adaptive bot at **double** lookahead | still dead — so this is a finding about the maze, not about the bot |

Deepening the bot's horizon from 8 to 40 tiles moved survival around within 26 s–128 s and
never approached the budget, which is the check that matters: a bot that died of myopia
would look identical to a maze that cannot be farmed. The three guarantees the caveat asked
for all hold — the Sparrow does take the opposite arc, scatter does break the orbit, and
pest speed sits at 90–106% of the player's across the level curve.

The other side of the same coin: it is not a coin toss either. A good player gets minutes,
not seconds, which is what the suite asserts as a floor.

**Can two pests seal the spawn pocket at row 25, cols 10–17? It could — that is why the
maze changed.** With the original two exits, two pests on them killed the bot in under a
second and the live AI wandered into that configuration on ~1.5% of ticks. See Revision 3
above. After opening `(10,24)` and `(17,24)`: two pests no longer seal it (the bot survives
the whole budget), four pests still do, and the live AI never once produced a four-way seal
while the bot was inside the room.

**Cornering.** Worth exactly `cornerLead` (40 subunits, a third of a tile) per corner, so
**1⅓ tiles per lap** of a four-corner loop — a 157-tick lap against 167 without it, ~6%.
Pests turn only on tile centres and can never take it back. Measured in
`test/chomp-cornering.test.ts` against a control run with `cornerLead` set to 0.

### 7.3 The Phase 4 answer — the difficulty curve, measured 2026-08-04

§7.2 answered "can this be farmed?" at level 1. That answer does not carry: the per-level
curve moves pest speed, scatter length and the frightened window, i.e. every quantity the
level-1 answer rested on. So the same bot ran again at three points on the curve — pests
slower than the player, level with them, and faster.

| level | pest/player | fright | bot, 5-min budget | at double lookahead |
|---:|---:|---:|---|---|
| 1 | 0.900 | 6.0 s | dead in **18.0 s** | dead in **40.3 s** |
| 5 | 0.975 | 2.0 s | dead in **23.0 s** | dead in **81.5 s** |
| 9 | 1.012 | 1.0 s | dead in **10.4 s** | dead in **8.3 s** |

No hole opens. Survival rises slightly to level 5 and collapses at level 9, which is the
shape the curve is meant to have.

**Does cornering stop mattering once the pests are faster?** This one does not need a bot
— running chases and counting seconds gives noisy, self-contradicting answers (the same
A/B came out −1300 ticks at level 1, +3320 at level 5 and −443 at level 9, which says
nothing except that a chase is chaotic). It is a break-even ratio, and it is exact.

Per lap of a four-corner loop `L` tiles round, a perfect corner-cutter travels
`L·SUB − 4·cornerLead` while the pest must travel `L·SUB`, netting
`L·SUB − r·(L·SUB − 4·cornerLead)` where `r = pestSpeed/playerSpeed`. Subunits gained per
lap:

| level | ratio | girth-10 ring | 22-tile spawn loop | 32-tile pen loop |
|---:|---:|---:|---:|---:|
| 1 | 0.900 | +264 | +408 | +528 |
| 5 | 0.975 | +186 | +222 | +252 |
| 9 | 1.012 | +147 | +129 | +114 |
| 13 | 1.038 | +121 | +67 | +22 |
| 17 | 1.048 | +110 | +42 | **−15** |
| 21+ | 1.063 | +95 | **+5** | **−70** |

Break-even ratios: **1.154** (girth-10), **1.065** (22-tile), **1.043** (32-tile). The pest
table tops out at **1.0625**.

So the set of loops a perfect player can hold **shrinks** as the levels climb — the big pen
loop is lost around level 15, the 22-tile spawn loop survives to the top of the table by
0.2%, and the tight ring is never lost. That is the right shape: what is left at the end
are the loops with the most junctions on them, where holding position is not safety.

The 0.2% margin on the 22-tile loop was **luck, and is now an invariant** —
`test/chomp-levels.test.ts` asserts the top of the pest table stays under that break-even,
so raising it is a decision someone has to make on purpose.

---

**The honest caveat** *(written before Phase 3; answered by §7.2 above, kept because the
reasoning is still the reason the maze is shaped this way).* Geometry alone cannot make
kiting impossible — it only makes it *defeatable*. Whether a competent player can farm the
pen loop is decided in Phase 3 by the AI and the speed curve, and it needs three specific
guarantees:

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
AI/speed tuning first, and only then geometry. *(Done — see §7.2. The answer was "no", and
the one geometry change that was needed was for a different problem: the spawn pocket.)*

**Design notes**

- **Mirror-symmetric** about the vertical axis: `row[x] === row[27-x]` for every cell,
  verified on all 31 rows. Not vertically symmetric — the bottom third is a distinct
  "paddy steps" pattern (rows 24–29) so the two halves of the maze don't read the same.
- **Warp tunnel** on row 14 only, both edges open. Cols 0–5 and 22–27 are deliberately
  **pellet-free** so the tunnel is an escape route, not a scoring lane. It feeds the
  col-6 / col-21 vertical shafts.
- **Central pen**: walls cols 10–17 rows 12–17, interior 6×4 (cols 11–16, rows 13–16) —
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
- 282 pellets + 4 power pellets = **286 collectables** per level. *(280 + 4 until the
  row-24 revision added two tiles.)*

**Decided since:** player spawn is row 25, straddling cols 13/14. Scatter corners are the
four corner corridor tiles — Rat (26,1), Sparrow (1,1), Weevil (26,29), Locust (1,29) —
and live in `levels.ts`. **Bonus spawn resolved in Phase 4:** row 18, straddling cols
13/14 — the sub-pen loop corridor. The proposal here said "row 17-ish centre, but that is a
wall"; row 17 is indeed wall, and the true centre of a 28×31 maze is row 15, which is
*inside the pen*. Row 18 is the first open corridor below the gate, dead centre
horizontally, and reaching it costs position in the middle of the board — which is the
whole point of a bonus item.

---

## 8. The Phase 5.5 answer — the board, measured 2026-08-04

### 8.1 The two assets, and what they cost

Neither shipped as delivered. Both were over the spec's per-file cap, and one had a second
problem that a byte count would never have found.

| | delivered | shipped | note |
|---|---|---|---|
| wall texture | `ricechompbackground.png`, 1192×1320, **3.12 MB** | `paddy-wall.webp`, same pixels, **242 KB** | 10.9× over the 300 KB cap. WebP q60; the knee of the size/quality curve sits right here, and the image is darkened 52% and masked to 1–2 tile strips, so q60 artefacts are not reachable by eye. Full resolution kept in preference to higher quality — upscaling softens structure, and blocking does not survive the darkening. |
| pit video | `rice..mp4` *(sic)*, 1080×1080, **363 KB**, `yuv420p10le` | `rice.mp4`, 320×320, **67 KB**, `yuv420p` | Over the cap, 7× oversized for a ~162px-wide pit, **and 10-bit**. |

**The pixel format is the finding worth keeping.** `yuv420p10le` is 10-bit H.264, which
Safari will not decode. A video that silently fails on iOS looks exactly like one that is
slow to start, so it would have shipped, and it would have looked perfect on every machine
anyone here could test it on. The byte count and the codec name were both fine. Check
`pix_fmt`.

`public/` is served wholesale, so leaving either original beside its replacement would have
shipped it anyway. Both are out of the repo entirely.

```
public/chomp/  paddy-wall.webp  247,908 B
               rice.mp4          68,241 B
               TOTAL            316,149 B   of 500,000   (63%)
```

Verified on a real build: `/chomp` still lists **no external host** but its own canonical
URL, and both files resolve through `asset()` — `/chomp/rice.mp4?v=<BUILD_ID>`, no
hardcoded prefix, immutable cache stamp.

### 8.2 The lettering, and whether it actually reads

"One Grain of" is on rows 6–7, "$RICE" on rows 9–10, both cols 10–17 — the only two 8×2
wall blocks in the centre column, stacked directly over the pit. Confirmed with the owner
before anything was drawn, because the instruction's literal reading ("the two-row wall
immediately below" the one above the pit) does not exist: below rows 9–10 come the row-11
corridor, the gate, and the pit itself.

Sizes are fitted from real Fredoka Bold metrics (measured off
`public/fonts/fredoka-latin-700-normal.woff2`: "One Grain of" is 5.85em wide and 0.75em of
ink, "$RICE" is 2.60em and 0.82em):

| tile size | block | "One Grain of" | "$RICE" |
|---|---|---|---|
| 27px desktop | 216×54 | 34px font, ~24px cap *(width-bound)* | 43px font, ~30px cap *(height-bound)* |
| 20px tablet | 160×40 | 25px font, ~18px cap | 32px font, ~22px cap |
| **13px portrait** | 104×26 | **16px font, ~11px cap** | **21px font, ~15px cap** |

**It reads at 13px.** An 11px cap height in a bold rounded face is small but not marginal,
and the long line is the worst case by a wide margin.

The two lines are deliberately not the same size, and the reason is the thing that would
get "tidied": `$RICE` is height-bound because the dollar sign overshoots both the cap line
and the baseline (0.82em of ink against 0.75em), so a single assumed cap-height constant
fits one line and clips the other. The fit uses `actualBoundingBox` metrics instead, which
is exact, and reserves the halo stroke's width — a stroke is centred on the outline, so
half of it sits outside the glyph, and fitting the fill then stroking it is how text ends
up clipped.

Contrast of bone `#f4efe2` on the darkened texture, measured from the shipped WebP:

```
texture grey levels     mean 109   95th pct 154        (0-255)
after 52% darkening     mean  53   95th pct  74
bone on mean patch      11.2 : 1
bone on brightest 5%     8.1 : 1   <- the worst case the lettering meets
bone on black corridor  19.1 : 1
```

Past WCAG AAA at the worst patch, before the nori halo is counted.

### 8.3 The wall mask — shipped broken, and what found it

The texture landed in the first commit of this phase wired up correctly, referenced through
`asset()`, decoded, in budget, re-baking on resize, with 167 tests passing — and produced a
board **pixel-identical to the untextured one**. No error, no warning, a 200 on the asset.
It took a round trip with the owner to find, and the reason is worth writing down.

`destination-in` composites the source against the **whole canvas**, not against the
rectangle being drawn. The mask was ~380 separate `fillRect` calls, so each one erased what
the previous ones preserved. Instrumented, three wall tiles at a time:

```
after texture + darken veil:      alpha at (10,9)=255  (13,9)=255  (17,9)=255
gCO at mask time = "destination-in"   fillStyle = "rgba(0, 0, 0, 0.52)"
  after mask fillRect #1 (10,9):  alpha at (10,9)=133  (13,9)=0    (17,9)=0
  after mask fillRect #2 (13,9):  alpha at (10,9)=0    (13,9)=0    (17,9)=0
  after mask fillRect #3 (17,9):  alpha at (10,9)=0    (13,9)=0    (17,9)=0
```

Two bugs in four lines. The mask is now a single path fill — one operation, one composite —
and its fill style is set opaque rather than inherited from the darkening veil, because
`destination-in` reads the source's *alpha* and 133 is 52% of 255.

Before and after, same maze, 27px tiles at DPR 2:

| | pixels differing from the flat layer | wall centre (col 13.5, row 9.5) |
|---|---:|---|
| broken | 73,592 of 2,531,088 *(the thicker keyline, and nothing else)* | `rgba(42, 77, 143)` — porcelain |
| fixed | 1,414,160 | `rgba(46, 48, 32)` — darkened paddy |

**What found it was running the real `bakeWalls` and looking at the pixels**, which had
never been possible: vitest here is node-env by design, so the render layer had no tests at
all. `test/canvas2d-shim.ts` is a small deterministic Canvas2D — enough for the bakes,
nothing more — implemented from the spec's Porter-Duff formulae rather than from
`render.ts`, and pinned against hand-computed values in `canvas2d-shim.test.ts` so that a
shim written by the same hand as the code cannot quietly agree with its bugs. Writing it
also caught one bug in the shim itself first: `makeCanvas` assigns `.width` *after*
construction, so plain fields left the backing store at 0×0 and every draw landed nowhere —
which looks precisely like "the texture never arrived".

**The regression test is `test/chomp-board.test.ts`, and its exact wording matters.** The
assertion is *many, widely separated wall blocks are textured*, not *the textured layer
differs from the flat one*. Verified by reverting the fix: only that one assertion fails.
The plainer test — the obvious one to write — **passes against the bug**, because one tile
does survive and the keyline is thicker on the textured board anyway. A test that samples a
single tile, or that only asks whether anything changed at all, would have shipped this.

The silent `.catch()` on `img.decode()` is also gone. A caught decode failure produced a
board that looked completely healthy, which is indistinguishable from the texture being
applied and doing nothing — the ambiguity is what made this cost a round trip. It now warns
and still degrades to the flat board.

### 8.4 The pit video, and what the crop cuts

The source is square, the pit is 6×4 tiles (3:2), so COVER crops vertically: the full width
is kept, the middle **66.7%** of the height survives, and the top and bottom **16.7%** are
cut. On this footage — a single lit grain of rice on a near-black vignette — that is empty
background on both sides; the grain is untouched. `PIT_VIDEO_FOCUS` is that slice's centre,
named rather than hardcoded so the framing can be nudged without going near the draw maths.

Drawing it on the canvas rather than in a DOM layer behind it is the decision worth keeping.
It inherits the letterbox, the DPR cap and the z-order the renderer already has, so it stays
aligned through resize and portrait for free, and the pests waiting in the pen composite
over it with no stacking-context work at all. A positioned element would have needed the
same two pieces of maths maintained a second time, and they would have drifted.

It is also the one thing on the board that cannot be baked — it is the only part that
changes while the simulation does not — and `test/chomp-audio.test.ts` now holds it to the
cutscene rule: no engine module may mention a video, `render.ts` may not create one or set a
`src` or call `play()`, no engine module may import `asset()`, and a run is tick-for-tick
identical whether the video plays, stalls or never loads.

**167 tests pass** (`test/chomp-*`), typecheck and lint clean, and a production build
prerenders `/chomp` static as before.

---

## 9. The Phase 5.6 answer — the chrome, measured 2026-08-04

Three changes to the page around the board, no engine change: the site nav is mounted on
`/chomp`, the route's text is on a fluid ramp, and "back to the rice paddy" became a
board-edge button on wide landscape viewports. Everything below was measured in headless
Chrome over CDP at seven viewports, against the shipped build (`0126a80`) as the before.

### 9.1 What the chrome costs the board

`tile` is the whole answer — the maze is 28 tiles wide and the tile size is
`floor(min(width/28, height/31))`, so it is the one number that says whether the board got
smaller.

| viewport | tile before | tile after | board before | board after | nav |
|---|---:|---:|---|---|---|
| 390×844 portrait phone | 13 | **13** | 364×403 | **364×403** | 57px |
| 844×390 landscape phone | 5 | **5** | 140×155 | **140×155** | hidden |
| 1024×1366 tablet portrait | 35 | 34 | 980×1085 | 952×1054 | 57px |
| 1366×768 laptop | 17 | 15 | 476×527 | 420×465 | 57px |
| 1920×1080 | 27 | 24 | 756×837 | 672×744 | 57px |
| 2560×1440 | 39 | 35 | 1092×1209 | 980×1085 | 57px |
| 3840×2160 | 62 | 58 | 1736×1922 | 1624×1798 | 57px |

**Portrait is free, and that is not luck — it is the maze's aspect.** A 390-wide phone is
*width*-bound (390/28 beats 844/31 by a mile), so the nav's 57px and the HUD's extra
leading come out of vertical slack the letterbox was already wasting. The board is
identical to the tile.

**The landscape phone pays nothing either, because the nav is not there** — hiding it below
520px of viewport height returns the board to exactly its pre-change size, tile for tile.
That is the whole point of the rule: it recovers what the nav took and does not pretend to
fix a viewport that was already bad (see §9.6).

**Every other landscape viewport pays, and the cost is roughly the nav.** At 1080p the play row
loses 87px: 57 of nav and ~30 of taller HUD and header text, for three tiles. That is the
trade the changes ARE — a bar and bigger numbers on a page with a fixed height budget can
only come out of the maze — and it is recorded here so it is a decision rather than a
discovery.

**The gutter columns cost nothing.** At 1080p the board needs 672px of a 1536px middle
column; it is height-bound with 864px to spare. That holds at every landscape size
measured, which is why the columns are gated on `landscape:` — in portrait the same
gutters would come straight off the maze, so there they do not exist.

### 9.2 Two bugs found by measuring, both invisible by inspection

**1. `Enter` on a focused link did nothing, and had never worked.** The window key handler
guarded its `preventDefault` with `tagName === "BUTTON"`, so every anchor on the page had
its activation cancelled. Verified against the *shipped* build before touching anything —
focus the "back to the paddy" link, press Enter, land on `/chomp`. The nav would have made
this a page full of dead links. The guard is now `closest("a[href],button,[role='button'])`,
and after the fix the same test lands on `/home`.

**2. Hiding the nav collapsed the board to nothing.** A `display:none` element is not a
grid item, so the moment the nav hid itself on a landscape phone, `main` auto-placed into
row ONE — the `auto` row — and sized to its own content. The play row's `1fr` had nothing
to be a fraction of, the canvas measured a zero-height box, and the retry loop spent its
60 frames on a box that was never going to settle. **The board did not render at all**, and
the failure mode is a canvas sitting at its 300×150 default, which looks exactly like a
canvas that has not loaded yet. Fixed by naming the row (`row-start-2`) so placement does
not depend on whether the nav is rendered.

Both are the same shape as the wall-mask bug in §8.3: correct-looking code, no error, no
warning, and a page that is wrong in a way you have to *measure* to see.

### 9.3 The fluid type ramp

`--text-chomp-*` in `globals.css`, ten tokens, one per size the route already used.

```
                      390px   1080p   1440p    4K     (vmin-driven)
HUD label              8.8     12.3    14.2    15.0
HUD score             20.0     33.6    38.6    40.8
page h1               20.0     42.0    48.3    51.0
lives / bonus icons     22       31      35      37
```

The floor is exactly the size it replaces and the ramp starts at 390px, so **the portrait
column of that table is unchanged from before, to the decimal** — verified, not intended.
`vmin` rather than `vw` because the board is letterboxed into the smaller axis; `vw` would
have grown the HUD most on an 844×390 landscape phone, the viewport with the least room.

No overflow anywhere: `scrollWidth - clientWidth` and `scrollHeight - clientHeight` are
both 0 at all seven viewports, before and after.

### 9.4 Is the same problem site-wide? Yes. Left alone deliberately.

Measured on the live build at 1080p, 1440p and 4K:

```
              /home        /memes       /pfp         /
body           16 16 16     16 16 16     16 16 16     16 16 16
first heading  16 16 16     44 44 44     56 56 56     11.2 ×3
first para     16 16 16     11.2 ×3      13.1 ×3      —
nav logo       18 18 18     18 18 18     18 18 18     16 16 16
```

**Not one number moves between 1080p and 4K on any page.** The site's largest breakpoint is
`lg` (1024px), so everything above it renders at the same size a 1024px laptop gets — a
4K monitor is showing 16px body copy and an 18px logo. `clamp()` appears 31 times in the
repo but only inside `/charity` and `/memes`' own scoped styles, never in the shared
components. This is a real problem and it is **not** fixed here: the `chomp-` prefix on the
tokens says they are a route's scale, not the site's, and a site-wide type scale is a
change to every page's rhythm that deserves its own pass.

### 9.5 Zero third-party requests — and a better instrument

The old check (`curl | grep -oE 'https?://[a-z0-9.-]+'`) now reports four third-party
hostnames on `/chomp`: `t.me`, `x.com`, `www.instagram.com`, `jup.ag`. **All four are
`<a href>` targets in the nav. None is a request.** The criterion is unchanged and still
passes; the instrument was wrong and is replaced — see the spec's Acceptance criteria for
what is measured now. Results:

```
static:   0 external fetching elements (script/link/img/video/source/iframe)
          0 external preload/preconnect/dns-prefetch   (13 preloads, all /_next/…)
          0 external URLs in the 14 JS/CSS chunks /chomp loads, other than
            link targets and the (guarded, and pre-existing) translate string
runtime:  37-49 requests per load (it varies with what the browser still has
          cached), every one of them same-origin — 0 third-party, at all
          seven viewports
```

The `translate.google.com` string is in a chunk `/chomp` loads and **always was**, in the
pre-change build too: what Phase 5 removed was the script tag, not the string. Only the
runtime measurement can tell those two apart, which is the argument for having it.

### 9.6 What was left alone

- **Landscape phone is still a bad place to play**, at six tiles. The chrome on a 390px-tall
  viewport is ~220px of header, HUD and footer, and above 640px wide the HUD switches to its
  desktop form and gets *taller*. Hiding the nav there recovers what the nav took and no
  more. Not in this phase's scope, and the spec's position is that portrait is the case.
- **Opening the 🌾 Menu mid-run does not pause the game.** The nav has no handle on the
  engine and the game has no idea the menu exists, which is the separation the whole file
  layout is built on; wiring them together to pause is a real feature with a real argument
  and not a side-effect to slip in here. (`Escape` closes the menu *and* toggles pause, since
  both listen on the document — which happens to be the behaviour you would want anyway.)

---

## 10. The Phase 6 answer — the leaderboard, measured 2026-08-05

Everything below was measured against a real production build (`phase6e`) served on the
preview port, in headless Chrome over CDP, at eight viewports — the seven §9 used plus a
1024×768 tablet landscape, which is where the docked panel is tightest.

### 10.1 What the panel costs the board: nothing, at every viewport

`tile` is still the whole answer. Each row is measured three times: with the board closed,
with it open, and after closing it again.

| viewport | tile closed | tile OPEN | tile re-closed | form | pauses? | overflow |
|---|---:|---:|---:|---|---|---|
| 390×844 portrait phone | 13 | **13** | 13 | overlay | **yes** | 0/0 |
| 844×390 landscape phone | 5 | **5** | 5 | overlay | **yes** | 0/0 |
| 1024×1366 tablet portrait | 34 | **34** | 34 | overlay | **yes** | 0/0 |
| 1024×768 tablet landscape | 15 | **15** | 15 | docked | no | 0/0 |
| 1366×768 laptop | 15 | **15** | 15 | docked | no | 0/0 |
| 1920×1080 | 24 | **24** | 24 | docked | no | 0/0 |
| 2560×1440 | 35 | **35** | 35 | docked | no | 0/0 |
| 3840×2160 | 58 | **58** | 58 | docked | no | 0/0 |

Every one of those tile sizes is **identical to §9.1's "after" column** — the numbers
Phase 5.6 shipped. The leaderboard costs the maze nothing anywhere.

**That is not luck, and it is the answer to the one thing worth checking before designing
the panel.** The play row's left gutter was already 8rem (`lg:`) / 11rem (`xl:`) and
empty; it grows to 20rem / 24rem while the board is open, and it is cut from margin that
was already there. At 1080p the middle column has 1536px for a 672px board — the board is
height-bound in landscape, always, because the maze is 28:31. In portrait, where width
binds, the columns do not exist at all and the panel is an overlay instead. The play row
is still `grid-rows-[minmax(0,1fr)]` with exactly one `1fr`, the canvas still owns the one
`1fr` column, and the degenerate-measurement retry is untouched.

**Both column sets are written out as whole literal class strings** rather than composed
from parts, because Tailwind reads the source and cannot generate a class assembled at
runtime.

### 10.2 Two bugs found by measuring, and one design rule that came out of it

**1. Pausing resized the maze, on tablets, mid-run.** With two more buttons in it, the HUD
row sat within **11 pixels** of its flex-wrap point at 1024×1366. "Resume" measures 89px
against "Pause"'s 84 — so pressing pause wrapped the row, took 44px of HUD height out of
the play row, and dropped the board from a 34px tile to a 32px one. It did not reliably
come back on resume, which made it read as a resize bug rather than as a wrap.

```
             tile  hudH  cluster  caption
running        34    81      438  Pause      <- after the fix
paused         34    81      438  Resume
board open     34    81      438  Resume
board closed   34    81      438  Pause

running        34   125      424  Pause      <- before it
paused         32   125      435  Resume
resumed        32    81      424  Pause      <- and it stayed at 32
```

Fixed twice over, because either half alone leaves the failure available: the row gained
real margin (`sm:gap-x-6`, 32px across four gaps, and `px-2.5` on the four cluster
buttons) and the pause button gained a width floor so its caption can never resize it.
**A control whose caption toggles must not change size** — that is the general rule, and
it is now in the spec.

**2. Opening the board fired the request twice.** Both forms of the panel are mounted and
CSS hides one — but `display:none` is a rendering decision, not a React one. The hidden
component mounted, ran its effect, and fetched: two identical no-store GETs and two pairs
of indexed reads, one of them for a panel nobody could see. `fetchBoards()` now shares an
in-flight request. Measured after: **one** `/api/chomp/*` request per open.

Both are the same shape as §9.2's and §8.3's: correct-looking code, no error, no warning,
and a page that is wrong in a way you have to *measure* to see.

**The design rule that came out of it: ask the LAYOUT, not a media query.** The pause rule
needs to know whether the docked panel or the overlay is on screen, and the obvious way is
a `matchMedia("(min-width: 64rem) and (orientation: landscape)")` string in the component
— which then has to stay in step with the `lg:landscape:` Tailwind classes on the elements
themselves, forever, in two files. Instead the docked container is always mounted and the
rule reads `offsetParent != null`, which is null exactly when CSS has set `display:none`.
One source of truth, and it is the real CSS rather than a description of it.

### 10.3 The submission path, end to end

Played by the difficulty suite's clearing bot, submitted over HTTP exactly as the browser
does, against the running build. A level-1 clear: **score 3720, 4102 ticks, 282 grains, 4
golden, 2 pests, 1 bonus, and a 315-byte trace.**

> **This log is the TWO-BOARD build, and it is not re-run.** *Marked 2026-08-05, with the
> removal; see §10.6 for why, and for the one measurement that WAS re-run.* Two of its lines describe a board that no longer
> exists — `countryRank:1` and "the country is on the countries board" — and the table
> and index lists below name `chomp_countries`. Every other line still describes the
> shipped path unchanged: the removal deleted a second table's upsert from the submit
> transaction and touched nothing else on the way in.
>
> What replaced it as a STANDING check is `test/chomp-db.test.ts`, added with the
> removal and run by `npm test`: against a real throwaway SQLite file it asserts exactly
> two `chomp_*` tables, one row per player at their best score, the dedupe no-op, and
> `country_code` reaching the board as the flag column with a GeoIP miss surviving as a
> ranked row. A hand-run smoke that nobody re-runs is worth less than a cheap one that
> runs on every commit.

```
ok  session route mints a signed cookie
ok  a real run is accepted            {rank:1, countryRank:1, improved:true}
ok  resubmitting the identical run is a no-op   (duplicate:true, games still 1)
ok  the player is on the players board          Paddy Ace · 3720 · JP
ok  the country is on the countries board       JP Japan · 3720 · Paddy Ace
ok  the name is suggested back for next time
ok  a wild score is refused           422 score does not match what the run says it did
ok  a debug run is refused            422 debug runs cannot be submitted
ok  a one-tick run is refused         422 run is too short to be a run
ok  an empty name is refused          400 Names are 3-12 characters.
ok  a profane name is refused         400 Pick another name.
ok  a malformed trace is refused      400 unexpected character in trace at 3
ok  a submission with no session      401
ok  the per-vid rate limit bites      3 of 8 refused with 429
```

The database it created, read back off disk:

```
journal_mode wal | synchronous NORMAL | wal_autocheckpoint 1000 | page_size 4096
tables:  chomp_countries, chomp_players, chomp_runs
indexes: idx_chomp_countries_best, idx_chomp_players_best, idx_chomp_runs_created,
         idx_chomp_runs_dedupe, idx_chomp_runs_iphash, idx_chomp_runs_score,
         idx_chomp_runs_vid
row 1:   score 3720, ticks 4102, duration_ms 68367, seed 1000, trace 315 bytes,
         country JP, ip_hash present (raw IP never stored)
```

And the grains prefill, against the LIVE grains database, read-only:

```
Hero               -> Hero
DOC                -> DOC
RICE LORD OF PERU  -> RICE LORD OF PERU
unknown vid        -> null
a write on that connection -> throws "attempt to write a readonly database"
```

### 10.4 The operational trap this turned up

**A second copy of the app on this box will become a second writer of `chomp.db`.** The
preview server defaults to `<cwd>/data/chomp.db` exactly as the live process does, so
running both is precisely the thing the two-database design exists to prevent. It is now
documented in `.env.example` and the preview must be started with `CHOMP_DB_PATH` pointing
somewhere else. Found the way these things are found: by running the preview and then
looking at which file it had open.

Related and worth knowing at deploy time: **`data/chomp.db` does not exist yet in
production** and will be created on the first request after promote. The directory is
created on boot if missing, so nothing needs preparing — but it does mean the first
visitor to `/chomp` is the one who pays for the schema.

### 10.5 One flake, pre-existing, not this phase's

`test/chomp-kiting.test.ts` occasionally times out under a fully parallel `vitest run`
— its heavy simulations sit near the default 5000ms per-test budget and lose the race
when the box is busy. **It fails the same way on a clean tree** (verified by stashing:
2 failures there, 1 with this phase's changes, same tests both times) and it passes every
time in isolation and on an unloaded box (338/338). Left alone deliberately: raising a
timeout in another phase's suite is not this phase's call, but a suite that is red for
reasons unrelated to the change under test is how a real regression gets waved through, so
it is written down here rather than shrugged off.

### 10.6 The one-board build, re-measured — 2026-08-05

The removal (`b5d6dd2`) re-ran ONE of §10's measurements and deliberately not the other.

**Re-run: the third-party request count**, because it guards a spec acceptance criterion
(`/chomp` makes zero third-party requests) and it costs one headless browser. Preview
build `b5d6dd2` on :3099, Chrome over CDP, cache disabled, `CHOMP_DB_PATH` pointed at a
scratch file so the preview could not become a second writer of the live one — §10.4's
trap, respected rather than re-discovered.

| viewport | form | requests on load | with the board open | third-party |
|---|---|---:|---:|---|
| 1920×1080 | docked | 49 | **50** | **0** |
| 390×844 | overlay | 48 | **49** | **0** |

Every request in all four columns went to `127.0.0.1:3099` and nothing else. **Opening the
board costs exactly one request** — the single `/api/chomp/leaderboard` GET — at both
viewports, which is the standing proof that the in-flight share still holds: both forms of
the panel mount, only one fetch leaves. The same probe found **0 elements with
`role="tab"`** and one button captioned **"Board"**, so the removal is confirmed in a real
production build and not only in the source. The comparable two-board figure was 49–50
with both boards opened; the shape is unchanged and the page is a request lighter.

**Not re-run: §10.3's end-to-end submission smoke.** Lito's call, and the right one. It was
a hand-run log that nobody re-runs, and what it covered is now covered twice over by
things that run on every commit — `test/chomp-db.test.ts` for the write path against a
real SQLite file, and `test/chomp-score.test.ts`'s 29 cases for the submission path. The
log stays in §10.3 marked as a two-board measurement rather than reworded into a claim
nobody made.

---

## 11. The Phase 7 answer — the site's information architecture, 2026-08-05

The game did not change. The site around it did, and this section is here because one
part of that change could have undone two phases of work without anything going red.

### 11.1 The scheme, and the conflict in the brief

The brief asked for the Grains Game at `/grainsgame` **and** for the games to be
subpages of `/games`. Those cannot both hold. Settled on **`/games/<slug>` with no
exceptions** — `chomp`, `grains`, `catch` — for two reasons beyond consistency: `/games`
is a real index page and therefore a real parent, so a game outside it would make the
index link outward for one of three entries; and `playSurfaces.ts` is an exact-match
list, where one prefix is one rule and two prefixes are a list that gets half-updated.

| game | was | is |
|---|---|---|
| Rice Chomp | `/chomp` | **`/games/chomp`** |
| Grains Game | **`/`** (the landing page) | **`/games/grains`** |
| Catch A Grain | `/play` | **`/games/catch`** |

### 11.2 The route table, measured

Every path that resolved before the change, plus every new one, against a production
build on :3099. **The rule was no 404 from anything that resolved yesterday**, and the
brief's own two instructions collided on it: `/chomp` was described as movable with no
redirect, but it returned 200, so moving it bare would have created exactly the 404 the
other rule forbids. Lito's call was to carry the redirect — one line in a block that had
to exist anyway, and a rule with no exceptions is worth more than a rule with one.

```
/                200      <- now the HOME page (was the Grains Game)
/games           200      <- new
/games/chomp     200      /games/grains  200      /games/catch  200
/home            308 ->   /
/chomp           308 ->   /games/chomp
/play            308 ->   /games/catch
/memes /pfp /charity /dca /tma /classic   200      (untouched)
/grains          404      (never was a page — see 11.5)
```

**`/` is deliberately NOT a redirect.** It still returns 200; it just serves a different
page. That is a change to what a shared link *shows* — and `/` is the most-linked URL on
the site, including from the buy bot (`ricebuybot-src/src/core/links.ts`) — but it is not
a broken link, and redirecting it would send every existing bookmark somewhere it did not
ask to go. Confirmed as intended.

`next.config.ts` had no `redirects()` block before this phase; it has one now. Build-time,
so no nginx change and no sudo.

### 11.3 The thing that would have broken silently

`src/lib/playSurfaces.ts` matches route paths **exactly**, and five things read it. Moving
`/chomp` without moving its entry would have: switched the Google Translate script back on
(re-breaking the spec's zero-third-party-request criterion), and put the chopstick cursor,
the Konami arrow-key listener and the rice-particle field back over a live board. No
throw, no warning, no red test, a page that renders perfectly. It was updated in the same
commit as the route move.

**`test/play-surfaces.test.ts` is the standing guard, and it was checked against the
failure rather than only against success.** Reverting the list to `["/chomp"]` — the exact
Phase 7 hazard — turns **4 of its 9 assertions red**, with named messages:

```
× RICE CHOMP is a play surface, at the route it actually lives at
× '/games/chomp' play-surface status is true
× every play-surface route is a route that exists   (/chomp ... has no page.tsx)
× every play-surface route is one of the games      (/chomp ... not in src/config/games.ts)
```

**The brief's instruction here was wrong and was corrected before it was implemented.**
It asked for every game route to be added to the list. That list means "turn the ambient
decoration OFF here", not "is a game" — and following it literally would have deleted
Catch A Grain's controller (you catch grains *with* the chopstick cursor) and stripped the
Grains Game's cursor and particles. One of three games is a play surface. The test asserts
all three by name, including the two that must NOT be, because this failure runs in both
directions.

### 11.4 The three verifications, and the one that could not be run

| check | result |
|---|---|
| `/games/chomp` makes no third-party request on direct load | **PASS, both instruments** — runtime CDP: 55 requests desktop / 53 phone, **0 third-party**; static: 0 external fetching elements, no translate script, no widget mount |
| grains WebSocket connects from the new URL | **PASS** — 101 Switching Protocols, `init` frame with the live global total and both boards, ping at 6s, still connected |
| both leaderboards resolve their API routes | **PASS** — `/api/chomp/leaderboard` 200, `/api/leaderboard` 200 |

**The runtime measurement was run, and it needed the box changed to do it.** Chrome could
not start (six missing libraries; `sudo apt-get install libatk1.0-0t64
libatk-bridge2.0-0t64 libatspi2.0-0t64 libcups2t64 libxcomposite1 libxdamage1` on Ubuntu
24.04). This was initially reported as a gap and Lito closed it before Phase 7 promoted,
on the grounds that instrument error has been the recurring failure on this project —
which §8.3, §9.2 and §9.5 all bear out. He was right to insist: per §9.5 the runtime pass
is the **only** instrument that can tell a `translate.google.com` string sitting in a JS
chunk apart from an actual request, and that string is still in a chunk this route loads.

**The control is the half that makes the result mean something**, and it was run in the
same pass. Pointed at the pages that SHOULD make third-party requests:

```
/games/chomp    55 / 53 requests    third-party: 0          <- the criterion
/games/grains   42 requests         4 hosts   translate.google.com, www.gstatic.com,
/games/catch    31 requests         4 hosts   translate.googleapis.com, fonts.gstatic.com
/games          64 / 58 requests    4 hosts
/               102 requests        7 hosts   + fonts.googleapis.com, api.dexscreener.com,
                                                lite-api.jup.ag
```

Six distinct third-party hosts detected elsewhere, zero on the game. A probe that reports
"clean" everywhere is measuring nothing; this one demonstrably is not blind.

**A stale preview nearly poisoned this measurement, which is worth recording.** The first
attempt returned 200 from :3099 while the `next start` that owned the port had been left
running against a build directory already deleted from disk — Next keeps its file
descriptors open, so it happily serves a build that no longer exists. `lsof -ti:3099`
silently matched nothing and the kill was a no-op; `ss -lptn 'sport = :3099'` found the
pid. **Confirm what the preview is actually serving before believing a number off it** —
the build stamp is in the HTML (`grep -o 'phase7b'`), and checking it is one command.

The WebSocket check is worth a note: `useGrainsSocket`'s `wsUrl()` is built from
`window.location.host` + `BASE_PATH` and **never reads the pathname**, so the page move
could not affect it structurally. It was verified empirically anyway, with a cookie minted
from the new page's origin (`grain_vid` is `Path=/`, so it covers `/games/grains`). Every
`fetch()` in all three games is root-absolute through `asset()` or `BASE_PATH` — a
*relative* fetch would genuinely have broken under the deeper `/games/` path, and there
are none.

### 11.5 Two pre-existing bugs this phase swept up

1. **`/classic`'s GRAINS link was broken and had been for a long time.** The two links
   disagreed: the desktop one pointed at `/`, the mobile one at `/grains` — which has
   never been a page (`src/app/grains/` holds only `session/route.ts`, the cookie minter).
   Verified 404 against the live process. Both now point at one constant, `/games/grains`.
   Fixed here because this phase is what made the correct target exist: leaving the
   desktop link alone would have quietly repointed it at the home page.
2. ~~**Open question 9 — `globals.css`'s `/onegrainofrice/grains/chopstick-cursor.svg`
   404.**~~ **Already fixed.** The line now reads `/grains/chopstick-cursor.svg` and
   returns 200. Recorded so the open question below stops looking open.

### 11.6 What was left alone, and one thing that is still owed

- **No sitemap was created.** Lito's call, and the right one: there is no sitemap and no
  `robots.txt` on this site at all (`/sitemap.xml` → 404), and publishing one that points
  at routes that may still move is worse than not having one. A separate task.
- **The OG preview image is unchanged, and the wording around it is not.** The site-wide
  link preview described the Grains Game — alt text "tap to drop a grain of rice", OG
  `url: "/"` — which after the swap described a page that is no longer there. The alt now
  describes the art. **The FILE stayed**, because it is the only 1200×630 asset in
  `public/` (the alternatives are 1536×1024 and 1024×1536 at ~2.4 MB) and what it shows is
  the mascot on a bowl under a paddy sky — the brand, not a game screen: no HUD, no
  counter, no controls. **A bespoke home preview image is an art task and is still open.**
- **The Grains Game's landing gate was deleted, not relocated.** It withheld an "Enter the
  Rice Paddy" button until three grains had been dropped, which made sense when the game
  stood between a visitor and the site. At `/games/grains` the visitor has already been to
  the site to get here, so it was a door into a room they were standing in. The always-
  visible small twin survives as "← All games" pointing at `/games`; the rest of that
  screen is untouched.
- **RICE CHOMP's "back to the rice paddy" still goes HOME, not to `/games`.** It was
  repointed from `/home` to `/` — the same page — and no further. Repointing a named
  affordance at a different destination is a design change, and this page's nav bar
  already carries 🎮 Games.

---

## 12. Open questions

1. **Where is `docs/rice-chomp-spec.md`?** It is not in the repo or anywhere under
   `/home/deploy`. Should I proceed from the brief in your message, or do you want to
   drop the spec in first? Pest personalities, the scoring table, the level/speed curve
   and the art direction are all things I've had to guess or defer below.

2. ~~**Route path:** `/chomp`, `/rice-chomp`, or nested under `/play`?~~ **Answered
   twice.** Phase 2 shipped `/chomp`, in the site menu rather than as a hidden easter
   egg. **Phase 7 moved it to `/games/chomp`** and took the menu entry with it: the menu
   now has one 🎮 Games row pointing at a `/games` index, and all three games are cards
   there. `/chomp` keeps a 308. The scheme and its reasoning are in §11.1 and in the
   spec's *Route and information architecture*, which is authoritative.

3. ~~**One database or two?**~~ **Answered — TWO, and built that way in Phase 6.**
   `data/chomp.db` is written only by the Next process; `grains.db` is written only by
   `oneg-grains-ws`. The one thing two files seemed to cost — reading
   `visitors.display_name` for the name prefill — cost nothing in the end:
   `src/lib/chomp/grainsName.ts` opens grains.db `readonly: true, fileMustExist: true`
   and reads the row. That is a stronger guarantee than an ATTACH would have been, and
   `test/chomp-score.test.ts` asserts it is the only place this feature names that file.

4. ~~**Player identity and name.**~~ **Answered — the vid is shared, the name is not.**
   The spec settled it: the same signed `grain_vid` identifies the player (so no new
   secret, no new session route, no new cookie), and RICE CHOMP stores its OWN name per
   submission, 3-12 characters, merely PREFILLED from the grains name when there is one.
   A player is allowed a different name on an arcade board than on a clicker, and the two
   can drift apart without either being wrong. Not three initials: the grains board
   already trained visitors to type a name here.

5. ~~**How much anti-cheat do you actually want?**~~ **Answered — (b), built in Phase 6,
   with (c) left one server-side change away.** The engine has been integer-exact and
   replayable since Phase 2, every run records a tick-stamped input trace, and the trace
   is now STORED with the run — unverified, deliberately. So the day someone wants (c),
   nothing ships to a client and every run banked from today is verifiable retroactively.
   `test/chomp-score.test.ts` holds the bet honest by asserting a stored trace replays to
   the score it claims. What (b) does and does not catch is listed by name, in five
   numbered items, at the top of `src/lib/chomp/score.ts` — that list is the honest
   summary of the position and is the thing to read before adding a check.

   The original three options, for the record:
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

6. ~~**Per-country leaderboard as well as global?**~~ ~~**Answered — yes, and it is one
   of the phase's two boards.**~~ **Answered again, 2026-08-05, and the answer is NO.**
   It was built — top players and top countries, mirroring the grains game — and removed
   the same day, on Lito's call: one board, the top 50 players, with the country as a
   FLAG COLUMN beside the name rather than a board of its own. The extra table went with
   it. What the country board was for survives in the cheaper form: GeoIP was free on
   this vhost, it is captured on submission exactly as before, and a player's country is
   still visible on the board — it just does not compete. The ranking rule the country
   board established (a BEST run, never a sum, because a sum ranks whoever played most
   and is the one number a script can inflate without ever playing well) was never only
   about countries and still governs the one board there is.

7. ~~**`prefers-reduced-motion` policy.**~~ **Answered — (b), and built in Phase 5.**
   `GrainCatch` disables gameplay outright under reduced motion; RICE CHOMP does not
   copy that. The golden-grain pulse, the bonus bob and the maze flash are not drawn and
   the interstitial is dismissed before its first frame, all of which is presentation —
   a reduced-motion run and an ordinary one are tick-for-tick identical. There is no
   screen shake to strip; none was ever built.

8. ~~**Mobile input.**~~ **Answered — both, and portrait letterbox. Built in Phase 5.**
   Swipe is always live and re-anchors after every turn, so one unbroken thumb drag can
   trace a whole route; the d-pad is an addition, defaulting on for a coarse pointer and
   toggleable from the control bar. Portrait letterboxes and there is no rotate prompt,
   because the maze is 28:31 and very nearly square — on a 390×844 phone the board takes
   364×403 (13px tiles) with the compacted HUD above it and the d-pad plus control bar,
   about 250px, below. The HUD sheds its secondary numbers under `sm:` for the same
   reason: "pests eaten" is not worth a row of maze on a phone. Both routes end at
   `setWanted()`, which is the same call the arrow keys make; that is what keeps touch
   out of the input trace's business and it is asserted in `test/chomp-audio.test.ts`.

9. ~~**May I fix `globals.css:293` while I'm in here?** It's a live 404 —
   `/onegrainofrice/grains/chopstick-cursor.svg` should be `/grains/…`.~~ **Done, at some
   point before Phase 7.** The line reads `cursor: url("/grains/chopstick-cursor.svg")`
   and the asset returns 200 (re-verified 2026-08-05 against a production build). Closed.

10. ~~**Art and sound.**~~ **Answered.** Art, by practice: everything — player, four
    pests, six bonus items, both interstitials, the attract portraits — is drawn
    procedurally on canvas, and there is still nothing under `public/chomp/`. The only
    planned image was the paddy wall texture, which landed in Phase 5.5 along with the
    pit video — see §8. Sound, in
    Phase 5: `scripts/gen-sfx.mjs` extended with eight synthesized clips into
    `public/sfx/chomp-*.wav` (184 KB), played through `src/lib/sound.ts`, sharing the
    site's one persisted sound switch. The design rules the chomp rests on are in the
    spec's Sound section and in the script's own CHOMP header — they are the part that
    would be "tidied" away by someone who had not sat with it for ninety seconds.

11. ~~**The four pests.** Absent the spec: names, look, and AI personality.~~
    **Answered.** The spec has them: Rat (direct), Sparrow (ambush 4 ahead), Weevil
    (flanking vector off the Rat), Locust (skittish inside 8 tiles). Built in Phase 3.
    One correction went back into the spec rather than staying here: the Weevil's wording
    read literally as `2 × rat − player`, which aims the flanker away from the player. It
    is `2 × pivot − rat`, pivot two tiles ahead of the player. See the spec's amendment.

12. **Pest colours are carrying less weight than usual, on purpose.** Rat tuna, Sparrow
    salmon, Weevil bamboo, Locust olive — and bamboo and olive are closer to each other
    than I would normally allow. That is deliberate: the requirement is that the four read
    apart in **monochrome**, so the silhouettes do the work and colour is a bonus channel.
    Worth a look on a phone once the paddy texture lands in Phase 4; if the two greens
    still fight, the fix is the Locust's bone highlight, not a new palette entry.
