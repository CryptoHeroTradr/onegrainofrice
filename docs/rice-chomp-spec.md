# RICE CHOMP — design spec

The reference document for every build phase.

> **This file is maintained, not archived.** When a decision supersedes something written
> here, this file is amended in the same commit that records the decision. It is meant to
> be true on its own — a reader should never need a chat log to know what is current.
> Amendments carry a date and, where the reasoning is not obvious, a line saying why, so
> nobody "fixes" a deliberate choice back to the original wording.

## What this is

An original arcade maze-chase game for the onegrainofrice site: the player clears a maze of rice grains while four rice-field pests hunt them with distinct AI personalities.

**Originality constraint.** This is a genre homage, not a clone. Do not use Pac-Man's name, its trademarked character designs, its exact maze layout, its ghost names or colors, or any of its audio. Maze layout, sprites, palette, sound and character names are all original and rice-themed. Mechanics — tile-based maze, pellets, power pellets, four chasers with distinct AI, scatter/chase cycles — are genre conventions and are fine to implement.

## Hard constraints

- Plain HTML5 Canvas 2D + TypeScript. No game engine.
- **Zero new npm dependencies** without asking first.
- **Zero external assets.** No CDN, no Google Fonts, no third-party requests at runtime. Art is drawn procedurally; sound is generated at build time by the repo's existing `scripts/gen-sfx.mjs` pipeline and played through `src/lib/sound.ts`. Everything ships from the VPS.
- Follow the repo convention: thin `page.tsx` → `"use client"` screen component → **directive-free engine module** with no React, canvas-DOM, or `window` references in its pure logic (same shape as `riceBowlEngine.ts`).
- **Fixed-timestep** simulation at 60Hz, accumulator-driven, decoupled from `requestAnimationFrame`. Identical gameplay at any refresh rate, no logic tied to raw delta time. This is load-bearing for the anti-cheat roadmap — do not let non-determinism in.
- Letterboxed to the maze's 28:31 aspect and scaled by `devicePixelRatio` (capped, so a 3× phone does not pay for pixels it cannot show).
- Anything static is painted once into an offscreen canvas and blitted per frame, so the hot loop only redraws what moves.
- Colors and fonts come from the existing `@theme` block in `globals.css` (13 colors, 4 font vars). No new palette.

### Tile grid vs render strategy

*Amended 2026-08-03. The original wording — "8px tiles at internal resolution", "locked
internal resolution … `imageSmoothingEnabled = false`", "procedural sprite atlas generated
once into an offscreen canvas at boot" — was meant to fix the logical grid unit for game
math. Read together it also mandated a 224×248 nearest-neighbour pixel-art buffer, which
was never a decision anyone made. The two concerns are separated below.*

The **logical tile grid is fixed at 8 units and is load-bearing.** Every piece of game
math is expressed in tiles and never in pixels: speeds in tiles/second, target-tile
selection, the Euclidean distance comparisons in the pest AI, maze girth and connectivity.
This does not change, and the render layer must never leak pixel units back into it.

**How a tile is drawn is a separate decision, isolated entirely within `render.ts`.** Two
modes are supported:

- **Native resolution — current.** Pick the largest whole-pixel tile that fits the
  viewport and draw anti-aliased at that size. Stays crisp at any DPR, avoids the thick
  letterbox bars integer scaling produces on odd viewports, and sits closer to the rest of
  the site's procedural-canvas look (`riceBowlEngine.ts`, `GrainCatch.tsx`).
- **Pixel art — supported alternative, not built.** A locked 224×248 buffer, an 8px
  procedural sprite atlas baked at boot, `imageSmoothingEnabled = false`, nearest-neighbour
  upscale.

Native resolution is chosen for now, and is revisited **after Phase 4**: neither look can
be judged honestly until four pests are moving through the maze, and switching costs only
a rewrite of `render.ts` — the engine is indifferent to both. That makes it the cheapest
late decision in the project, so it is deliberately deferred rather than guessed at.

What is *not* negotiable in either mode: no external assets, everything drawn
procedurally, everything shipped from the VPS.

### Path handling

`basePath` is `""` in production — the site owns its own domain and assets serve from the root with no prefix. **Never hardcode a path prefix, in TS or in CSS.** Use the same env-driven mechanism the rest of the app uses, or root-relative paths, so a future basePath change is one edit. The `/onegrainofrice/...` cursor URL in `globals.css` is exactly the bug this rule exists to prevent.

### Testability

`vitest` here is node-env and DOM-free by design. Maze parsing, per-pest target-tile selection, junction tiebreak, mode-cycle timing and scoring must be pure functions, importable without a DOM, and unit tested. The render layer can stay untested. `noUncheckedIndexedAccess` is off, so bounds-guard every tile lookup by hand.

## The maze

- 28 columns × 31 rows on the logical 8-unit tile grid (see *Tile grid vs render strategy*).
- Original symmetrical layout, warp tunnel on the left and right edges, central pen, no unfair dead ends, fully connected under warp-aware flood fill.
- Enough cross-connections that the maze is a network of loops, not parallel shafts — but no loop so long or so well-connected that all four pests can be kited around it indefinitely.
- Stored as a string array map, easy to edit, structured so additional layouts can be dropped in per level.
- Tile types: wall, path, grain, golden grain, pen door, tunnel, empty.

## The player

- **A single grain of rice** — the site's own motif — with a mouth animating open/closed and facing the direction of travel. *Amended 2026-08-03: this originally said a rice bowl. A bowl travelling down a corridor eating loose grains is a strange object, the single grain is already the site's motif, and a grain eating grains is the joke a $RICE game wants.*
- **The player grain must be unmistakable against the pellet grains at a glance** — in peripheral vision, mid-panic, not on careful inspection. Size, outline, colour from the theme block and the animating mouth all have to be doing work. If there is any moment where the player loses track of which grain they are, this has failed. **Verify on a phone screen, not a desktop one.**
- Grid-aligned movement with a **queued turn buffer**: a direction pressed before a junction is taken the instant it becomes legal. This is what makes the genre feel good — it is not optional.
- Slightly faster than the pests on open path.
- **Eating costs whole frozen ticks, not a reduced speed:** 1 tick of no movement per grain, 3 ticks per golden grain. *Amended 2026-08-03: this originally said "slightly slower while chomping grains". A blanket eating-speed value does not produce the same texture — the freeze is the mechanism that lets a pursuer close real distance on a player clearing a fresh corridor, and it is the reason the genre's chases tighten where the grains are thickest. There is no separate eating-speed dial; the freeze counts live in `levels.ts` with every other tuning number.*
- 3 lives, extra life at 10,000 points.

## The pests

1. **Rat** — direct pursuit: targets the player's current tile.
2. **Sparrow** — ambusher: targets 4 tiles ahead of the player's facing direction.
3. **Weevil** — flanker: targets a tile derived from the player's position mirrored through the Rat's position.
4. **Locust** — skittish: pursues directly when far from the player, retreats to its scatter corner within 8 tiles.

Shared behavior:

- Never reverse direction except on a mode change.
- At each junction, choose the legal direction minimizing Euclidean distance to the current target tile, tiebreak order up / left / down / right.
- Mode cycle per level: scatter → chase → scatter → chase, scatter phases shortening as levels progress. Each pest has its own scatter corner.
- Frightened mode on golden grain: pale, slowed, semi-random at junctions. Eaten pests become eyes that route back to the pen and respawn.
- Pen exit on a dot counter plus timer, staggered so all four don't emerge together.

## Scoring and progression

- Grain 10, golden grain 50, pest chain 200/400/800/1600 within a single power window.
- Bonus items appear twice per level at maze center for ~9 seconds: soy sauce bottle, chopsticks, nori sheet, sake cup, chili, sesame — escalating values by level.
- Level completes when all grains are cleared → maze flash → next level, faster pests, shorter frightened duration. From level 5 frightened mode is eventually disabled entirely.
- Interstitial cutscenes after levels 2 and 5: a short procedurally-animated beat (rat steals a grain, bowl chases it off-screen). Under 4 seconds, skippable.
- **Every tuning number** — speeds, timers, mode durations, score values, and the per-grain eating freeze — lives in `levels.ts`. No magic numbers in engine code. (`levels.ts` is created in Phase 3; Phase 2 predates it and holds its two movement constants in `engine/game.ts`.)

## Controls

- Keyboard: arrows and WASD. `P` or `Esc` pauses, `M` mutes.
- Touch: swipe and an optional on-screen d-pad, both available, d-pad toggleable. Portrait letterbox; never force or nag about rotation. Must be genuinely playable one-thumbed in portrait.
- Gamepad API if it's cheap; skip it if it isn't.

## UI and presentation

- Attract screen: title, pests introduced one at a time, high scores, start prompt.
- HUD: score, high score, level indicator as bonus-item icons, lives as small bowl icons.
- Game over → name entry → submission → leaderboard.
- `prefers-reduced-motion`: strip screen shake, maze flash and cutscenes; **gameplay stays playable**.

## Leaderboard

- Separate `data/chomp.db` via HTTP API routes, with the Next process as sole writer. The grains WS process keeps its single-writer contract untouched.
- `better-sqlite3`, WAL, idempotent `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` guards, matching the grains pattern. Set `PRAGMA wal_autocheckpoint` explicitly.
- Country attribution reuses the existing nginx GeoIP headers verbatim — no nginx change.
- Identity: `grain_vid` cookie for dedupe and rate limiting; display name entered per submission, prefilled from the grains board name if present. 3–12 chars, sanitized, profanity-filtered.
- Submission payload: name, score, level reached, duration, grains eaten, pests eaten, bonuses collected, and a compressed input trace.
- Validation, server-side, trusting nothing from the client: rate limit per `grain_vid` and per IP; reject scores above a plausible ceiling for the reported level and duration; reject impossibly short runs; verify score is arithmetically consistent with the reported event counts. Store the input trace unverified so replay validation can be added later as a server-side change only. Document in comments what this does not catch.
- Views: global top 100, per-country top 100, personal best in `localStorage`.

## Acceptance criteria

- 60fps on a mid-range phone; no GC stutter — pool objects, no per-frame allocations in the hot loop.
- Deterministic: identical inputs produce an identical run regardless of frame rate.
- Zero third-party network requests, verified in the network tab.
- Zero new npm dependencies.
- Fully playable keyboard-only and touch-only.
- No hardcoded path prefixes anywhere, TS or CSS.
- Pure-logic modules unit tested under the existing DOM-free vitest setup.
- The grains game and its WS process are untouched and still working.
