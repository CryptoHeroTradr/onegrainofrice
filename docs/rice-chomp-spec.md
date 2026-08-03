# RICE CHOMP — design spec

Save this file at `docs/rice-chomp-spec.md`. It is the reference document for every build phase.

## What this is

An original arcade maze-chase game for the onegrainofrice site: the player clears a maze of rice grains while four rice-field pests hunt them with distinct AI personalities.

**Originality constraint.** This is a genre homage, not a clone. Do not use Pac-Man's name, its trademarked character designs, its exact maze layout, its ghost names or colors, or any of its audio. Maze layout, sprites, palette, sound and character names are all original and rice-themed. Mechanics — tile-based maze, pellets, power pellets, four chasers with distinct AI, scatter/chase cycles — are genre conventions and are fine to implement.

## Hard constraints

- Plain HTML5 Canvas 2D + TypeScript. No game engine.
- **Zero new npm dependencies** without asking first.
- **Zero external assets.** No CDN, no Google Fonts, no third-party requests at runtime. Art is drawn procedurally; sound is generated at build time by the repo's existing `scripts/gen-sfx.mjs` pipeline and played through `src/lib/sound.ts`. Everything ships from the VPS.
- Follow the repo convention: thin `page.tsx` → `"use client"` screen component → **directive-free engine module** with no React, canvas-DOM, or `window` references in its pure logic (same shape as `riceBowlEngine.ts`).
- **Fixed-timestep** simulation at 60Hz, accumulator-driven, decoupled from `requestAnimationFrame`. Identical gameplay at any refresh rate, no logic tied to raw delta time. This is load-bearing for the anti-cheat roadmap — do not let non-determinism in.
- Procedural sprite atlas generated once into an offscreen canvas at boot.
- Locked internal resolution scaled by `devicePixelRatio`, letterboxed, `imageSmoothingEnabled = false`.
- Colors and fonts come from the existing `@theme` block in `globals.css` (13 colors, 4 font vars). No new palette.

### Path handling

`basePath` is `""` in production — the site owns its own domain and assets serve from the root with no prefix. **Never hardcode a path prefix, in TS or in CSS.** Use the same env-driven mechanism the rest of the app uses, or root-relative paths, so a future basePath change is one edit. The `/onegrainofrice/...` cursor URL in `globals.css` is exactly the bug this rule exists to prevent.

### Testability

`vitest` here is node-env and DOM-free by design. Maze parsing, per-pest target-tile selection, junction tiebreak, mode-cycle timing and scoring must be pure functions, importable without a DOM, and unit tested. The render layer can stay untested. `noUncheckedIndexedAccess` is off, so bounds-guard every tile lookup by hand.

## The maze

- 28 columns × 31 rows, 8px tiles at internal resolution.
- Original symmetrical layout, warp tunnel on the left and right edges, central pen, no unfair dead ends, fully connected under warp-aware flood fill.
- Enough cross-connections that the maze is a network of loops, not parallel shafts — but no loop so long or so well-connected that all four pests can be kited around it indefinitely.
- Stored as a string array map, easy to edit, structured so additional layouts can be dropped in per level.
- Tile types: wall, path, grain, golden grain, pen door, tunnel, empty.

## The player

- A rice bowl (or the existing $RICE mascot if the repo has one), mouth animating open/closed, facing direction of travel.
- Grid-aligned movement with a **queued turn buffer**: a direction pressed before a junction is taken the instant it becomes legal. This is what makes the genre feel good — it is not optional.
- Slightly faster than the pests on open path, slightly slower while chomping grains.
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
- **Every tuning number** — speeds, timers, mode durations, score values — lives in `levels.ts`. No magic numbers in engine code.

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
