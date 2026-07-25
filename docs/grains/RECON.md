# Grains — Phase 1 Recon

Findings for the rice-clicker game at `/onegrainofrice/grains`. This phase is recon +
persistence foundation only (no UI, no realtime server). Paths are repo-relative unless
absolute. Recorded 2026-07-06.

## App Router layout

- Framework: **Next.js 16.2.10** (App Router), React 19.2.4, Tailwind v4, TypeScript,
  pnpm. Self-hosted, `unoptimized` images, zero CDN.
- Root of the app: [`src/app/`](../../src/app/)
  - `layout.tsx` — root layout; mounts `<ChopstickCursor />` site-wide.
  - `page.tsx` — landing page.
  - `globals.css` — all global CSS (includes the chopstick cursor styles).
  - `loading.tsx`, `not-found.tsx`, `fonts.ts`, `favicon.ico`.
  - Routes: `classic/`, `pfp/`, `play/` (each a `page.tsx`). **New route goes at
    `src/app/grains/page.tsx`** (Phase 4).
  - API route handlers: [`src/app/api/`](../../src/app/api/) — `leaderboard/`, `charity/`,
    `players/`, `dao/`, `pfp/{enhance,status,generate-pfp,generate-art}/`. Each is a
    `route.ts`. **New handlers go under `src/app/api/grains/`.**
- Shared code:
  - [`src/lib/`](../../src/lib/) — pure helpers (`asset.ts`, `charity.ts`, `dao.ts`,
    `highscore.ts`, `sound.ts`, `resolveAsset.ts`, `pfp/`). **grains DB module lives at
    `src/lib/grains/db.ts`.**
  - [`src/config/`](../../src/config/) — `site.ts` (main site config), `home.ts`,
    `memes.ts`.
  - [`src/components/`](../../src/components/) — grouped by area (`rice/`, `sections/`,
    `journey/`, `pfp/`, `landing/`, `roadmap/`, `dao/`, `eggs/`, `home/`, …).
  - [`src/hooks/`](../../src/hooks/).
- Path alias: `@/*` → `./src/*` (see `tsconfig.json`).
- **basePath: `/onegrainofrice`** (set in `next.config.ts`, overridable via
  `NEXT_PUBLIC_BASE_PATH`). Images do NOT get the prefix automatically — every asset src is
  wrapped with `asset()` from [`src/lib/asset.ts`](../../src/lib/asset.ts), which prepends
  `NEXT_PUBLIC_BASE_PATH`. **Reuse `asset()` for grain sprites and any client fetch base.**

## Env loading & where secrets live

- **No formal env schema / validator exists.** The app reads `process.env.*` ad-hoc with
  `??` fallbacks. Server-only secrets are read inside route handlers or `src/lib/*` and
  never prefixed `NEXT_PUBLIC_` (so they stay out of the client bundle). Examples:
  - `src/config/site.ts` — `NEXT_PUBLIC_TOKEN_ADDRESS`, `NEXT_PUBLIC_BUY_URL`, `NEXT_PUBLIC_DAO_URL`, `NEXT_PUBLIC_VILLAGE_URL`, `NEXT_PUBLIC_HERO_FARM_AMBIENT`.
  - `src/lib/pfp/openai.ts` — `OPENAI_API_KEY`, `PFP_*_MODEL` (server-only).
  - `src/app/api/{charity,leaderboard,players}/route.ts` — `RICEDAO_API_BASE` (default `http://127.0.0.1:1112`).
  - `src/app/api/dao/route.ts` — `RICEDAO_DAO_FEED` (optional).
- Env files: only `.env.example` is committed (documentation); real values live in
  `.env.local` (gitignored via `.env*` with a `!.env.example` exception). No `.env.local`
  is present in the repo checkout.
- Convention takeaway: `NEXT_PUBLIC_` = browser-safe; everything else server-only. The
  `GRAINS_*` secrets (`GRAINS_IP_SALT`, `GRAINS_COOKIE_SECRET`) must stay **un-prefixed**.
- Phase-1 addition: `src/lib/grains/env.ts` centralizes `GRAINS_*` reading + validation
  (throws if the two secrets are missing when the DB module is used server-side), since no
  shared validator exists to hook into.

## Chopsticks CURSOR (verbatim, for Phase 4 reuse)

- **It is NOT a `cursor: url(...)` image.** The landing-page chopsticks are a React
  component that renders two inline SVG "sticks" following the pointer; the native cursor
  is hidden via a body class. Component:
  [`src/components/rice/ChopstickCursor.tsx`](../../src/components/rice/ChopstickCursor.tsx)
  (client component, `pointer-events: none`, mounted in `src/app/layout.tsx`).
- CSS lives in [`src/app/globals.css`](../../src/app/globals.css) (lines ~220–285).
  Verbatim key rules:

  ```css
  .chopsticks-active {
    cursor: none;
  }
  /* Native caret returns over text fields so typing is unaffected. */
  .chopsticks-active :is(input, textarea, [contenteditable=""], [contenteditable="true"]) {
    cursor: auto;
  }

  .chopstick-cursor {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 9999;
    pointer-events: none;
    opacity: 0;
    transition: opacity 140ms ease;
    will-change: transform;
  }
  .chopstick-cursor[data-show="true"] {
    opacity: 1;
  }

  .chopstick-pair {
    position: relative;
    width: 80px;
    height: 80px;
    transform: rotate(18deg);
    transform-origin: 39px 72px; /* the tip = cursor point */
  }
  ```

- Tip anchor (cursor hotspot) inside the 80×80 box: **`TIP_X = 39`, `TIP_Y = 72`**
  (constants in the component). Follow logic:
  `wrap.style.transform = translate3d(clientX - 39, clientY - 72, 0)`.
- Each stick SVG (verbatim tapered path):

  ```html
  <svg width="12" height="66" viewBox="0 0 12 66" class="stick stick-left" aria-hidden="true">
    <path d="M6 66 L8.6 6 Q8.9 1.5 6 1.5 Q3.1 1.5 3.4 6 Z"
          fill="var(--color-nori, #14110d)"
          stroke="var(--color-steamed, #fbf7ee)" stroke-width="0.7" />
  </svg>
  ```

- Grab convention: elements marked `[data-grab]` (plus native interactive elements matched
  by `[data-grab], a[href], button, summary, label, select, [role="button"], [tabindex]:not([tabindex="-1"])`)
  make the sticks **pinch**. On `pointerdown` the sticks pinch AND `playClack()` fires
  (`src/lib/sound.ts`, sound asset `public/sfx/chopstick-clack.wav`).
- Guardrails: only active on `(pointer: fine)` and NOT `prefers-reduced-motion`; otherwise
  renders nothing and leaves the native cursor alone.
- **Phase-4 reuse plan:** mark the clickable rice pile / grains with `data-grab` so the
  existing cursor pinches on it; call `playClack()` on grain clicks for the clack SFX. No
  new cursor CSS needed.

## Social links (existing component + markup)

- Config (source of truth): [`src/config/site.ts`](../../src/config/site.ts)
  - `site.socials` array (each `{ id: SocialId; label; href }`), `SocialId = "x" | "telegram" | "discord" | "globe"`:
    - `{ id: "telegram", href: "https://t.me/ricecontent" }` — "$RICE memes on Telegram (@ricecontent)"
    - `{ id: "telegram", href: "https://t.me/RiceDAOgamebot" }` — "Play the game — @RiceDAOgamebot"
    - `{ id: "x", href: "https://x.com/TODO" }` — "Follow $RICE on X" (**X URL is still a TODO placeholder**)
  - Also `site.channels.telegramMemes = "@ricecontent"`, `telegramBot = "@RiceDAOgamebot"`.
  - No TikTok or Instagram present today.
- Rendering components (map over `site.socials`, self-contained inline `SocialIcon`, no
  network — X has a bundled inline logo, others use `lucide-react`):
  - [`src/components/sections/Footer.tsx`](../../src/components/sections/Footer.tsx)
  - [`src/components/journey/HomeFooter.tsx`](../../src/components/journey/HomeFooter.tsx)
- **Phase-4 reuse plan:** render socials on the grains page by mapping `site.socials` with
  the existing `SocialIcon`; add TikTok/Instagram by extending `SocialId` + `site.socials`
  (and the `SocialIcon` switch) if needed.

## Grain sprite / assets (paths + sizes)

- **`public/hero-grain.svg`** — 1500 bytes, `viewBox="0 0 800 1000"` (radial-glow rice
  grain, the primary landing sprite). Served at `/onegrainofrice/hero-grain.svg` (wrap with
  `asset("/hero-grain.svg")`).
- **`public/memes/heart-grain.svg`** — 4101 bytes (heart-shaped grain, meme wall).
- CSS `.grain` class (feTurbulence overlay) is defined in `globals.css` and reused across
  phases.
- Chopstick-clack SFX: **`public/sfx/chopstick-clack.wav`** (played via `src/lib/sound.ts`
  `playClack()`).
- No raster grain PNGs; everything is inline SVG / small assets (zero CDN).

## pm2 / process layout

- This app runs under pm2 as **`onegrainofrice`** (pm2 id `3`), `fork_mode`:
  - script: `pnpm`, args: `start` → `next start -p 3006` (see `package.json`).
  - cwd: `/home/deploy/onegrainofrice`; interpreter node `v22.22.1` (nvm).
  - dev port `3005`, **prod port `3006`**.
- **There is NO ecosystem config for this app.** It was started ad-hoc via `pm2 start pnpm --name onegrainofrice -- start`.
  The only ecosystem file on the box belongs to a different app:
  `/home/deploy/RiceDAO/ecosystem.config.js` (apps `ricedao-web` :1111 cluster×2,
  `ricedao-server` :1112 fork).
- Other pm2 apps: `cxmz-site` (id 0), `ricedao-server` (id 1, :1112), `ricedao-web`
  (id 4, :1111).
- **Phase-3 note:** the WS server (`GRAINS_WS_PORT=3007`) will need its own pm2 process
  (and the `GRAINS_*` env). Consider adding a proper `ecosystem.config.js` for
  onegrainofrice (Next :3006 + grains WS :3007) so both carry the env consistently.

## nginx

- Server block file: **`/etc/nginx/sites-available/ip-rice`** (symlinked in
  `sites-enabled/`). It is the **default server for :80** (`listen 80 default_server;
  server_name 209.141.52.60 _;`).
- This app's location (verbatim):

  ```nginx
  # Longest-prefix match wins; no trailing slash on proxy_pass keeps the
  # /onegrainofrice prefix intact to match basePath.
  location ^~ /onegrainofrice {
      proxy_pass http://127.0.0.1:3006;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
  }
  ```

- Sibling apps in the same file: `/CXMZ/`, `/RiceDAO/` (:1111), `/RiceDAO/api/` (:1112),
  ACME challenge at `/.well-known/acme-challenge/`.
- **Client IP for grains:** requests arrive proxied, so the real IP is in
  `X-Real-IP` / `X-Forwarded-For` (nginx sets both above). The grains handler must read the
  forwarded header, not the socket peer (which is `127.0.0.1`).
- **Phase-3 note:** the WS endpoint (:3007) will need a `location ^~ /onegrainofrice/…`
  block with `proxy_set_header Upgrade $http_upgrade;` + `Connection "upgrade"` for the
  WebSocket handshake. Several timestamped `ip-rice.bak*` backups exist alongside the file.

## Toolchain / build notes

- Node `v22.22.1`, pnpm `11.10.0`. **No C/C++ compiler on the box** (`gcc`/`g++`/`make`/
  `node-gyp` all absent; only `python3`) — `better-sqlite3` **cannot compile from source
  here**. It installs via its **prebuilt binary**, fetched by the `prebuild-install`
  script (Node ABI 127, linux-x64; GitHub is reachable so the download succeeds).
  Confirmed loading OK: v12.11.1, `require('better-sqlite3')` opens a DB and round-trips a
  row (`build/Release/better_sqlite3.node`, 2.1 MB).
- **pnpm build-script gate (IMPORTANT):** pnpm 10/11 blocks native postinstall scripts
  by default and, once a package is in the `ignoredBuilds` cache, `pnpm install` **exits
  non-zero** (`ERR_PNPM_IGNORED_BUILDS`) — which also breaks `pnpm exec`/deploy. The fix
  is to explicitly approve the builds. pnpm 11.10's approval mechanism is the
  **`allowBuilds:` map** in `pnpm-workspace.yaml` (name → `true`/`false`); running
  `pnpm approve-builds --all` runs the scripts once and writes those approvals. After
  approval, `pnpm-workspace.yaml` contains:
  ```yaml
  allowBuilds:
    better-sqlite3: true
    esbuild: true       # from tsx (dev)
    sharp: true
    unrs-resolver: true
  onlyBuiltDependencies:   # older list form; harmless alongside allowBuilds
    - better-sqlite3
    - sharp
    - unrs-resolver
  ```
  With this committed, a fresh `pnpm install` runs the build scripts and **exits 0**
  (verified). A repo hook re-seeds the `allowBuilds:` block with `set this to true or
  false` placeholders whenever the file is edited by tooling — that just means "a human
  must approve"; set them to `true` (or run `pnpm approve-builds --all`).
- **Restore the better-sqlite3 binary if ever missing** (e.g. after `pnpm install
  --force` before approvals were set):
  `( cd node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 && ./node_modules/.bin/prebuild-install )`
- DB path: `GRAINS_DB_PATH=/home/deploy/onegrainofrice/data/grains.db` — the `data/` dir is
  created on boot by the DB module and is gitignored.
