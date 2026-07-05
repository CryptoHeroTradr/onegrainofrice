# 🍚 $RICE — One Grain of Rice

Single-page marketing site for **$RICE**, the meme coin for culture, community,
and real-world impact. Grungy vintage-zine collage: torn paper, washi tape,
sticker memes, and a 3D rolodex meme carousel.

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS v4 · Embla Carousel · pnpm · Node 20+

## Run it

```bash
pnpm install
pnpm dev        # dev server  → http://localhost:3005/onegrainofrice
pnpm build      # production build
pnpm start      # prod server → http://localhost:3006/onegrainofrice
pnpm lint
```

First run works out of the box — labeled placeholder images are pre-generated.

Dev and prod run on **separate ports** (baked into the scripts) so they never
collide — dev on **3005**, prod on **3006**. You can run both at once. Audit
accessibility against the production build:

```bash
pnpm build && pnpm start
pnpm dlx lighthouse http://localhost:3006/onegrainofrice --view
```

### Base path

The site is mounted under **`/onegrainofrice`** (it's hosted at
`209.141.52.60/onegrainofrice` on a shared nginx box), so every route and asset
lives under that prefix — the root `/` returns 404 by design. To serve at the
root instead (e.g. a dedicated domain), build with `NEXT_PUBLIC_BASE_PATH=""`.
VPS deployment steps — pm2 + the nginx route — are in [deploy/README.md](deploy/README.md).

## Privacy / telemetry

- Next.js telemetry is **disabled** (`pnpm exec next telemetry disable`, plus
  `NEXT_TELEMETRY_DISABLED=1` in `.env.example` for CI).
- **Zero runtime third-party requests:** fonts are self-hosted at build time via
  `next/font`, icons are bundled (`lucide-react`), paper-grain texture is an
  inline SVG data URI, and there are no analytics or external scripts.

## Configure your token

1. `cp .env.example .env.local`
2. Set `NEXT_PUBLIC_BUY_URL` (Jupiter / pump.fun / Raydium swap link) and
   `NEXT_PUBLIC_TOKEN_ADDRESS` (the real mint — shown with a copy button).
3. Everything else — copy, socials, impact stats, tokenomics allocation, FAQ,
   carousel autoplay flag — lives in [src/config/site.ts](src/config/site.ts).
   Search for `TODO` to find the placeholders.

## Swap memes (the whole point)

The carousel is driven by [src/config/memes.ts](src/config/memes.ts) — **one
line per card**:

```ts
{ id: "rice-cube", src: "/memes/rice-cube.svg", alt: "Ice Cube, 'RICE CUBE' jersey" }
```

Drop your real image into `public/memes/` and point `src` at it (jpg/png/webp/svg
all work). Optional `caption` adds the ribbon banner; optional `rotation` sets
the sticker tilt. Details in [public/memes/README.md](public/memes/README.md).
Regenerate placeholders anytime: `pnpm placeholders`.

## Fonts

All font choices live in [src/app/fonts.ts](src/app/fonts.ts) (display slab =
Zilla Slab, body mono = Courier Prime). Swap the import there and the whole
site follows.

## Carousel features

Drag/swipe (mouse + touch), prev/next buttons (≥44px targets), keyboard
arrows, infinite loop, dot indicator, optional autoplay (off by default, set
`memeWall.autoplay` in `site.ts`; pauses on hover/focus). Under
`prefers-reduced-motion` the 3D rotation/scale is dropped (flat scroll +
opacity) and autoplay never runs. Carousel region and slides carry proper
`aria-roledescription` labels.
