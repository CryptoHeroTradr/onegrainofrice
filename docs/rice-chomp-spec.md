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
- **Zero third-party runtime requests.** No CDN, no Google Fonts, no remote scripts, no remote images, no analytics — nothing the page fetches may leave the VPS. Sound is generated at build time by the repo's existing `scripts/gen-sfx.mjs` pipeline and played through `src/lib/sound.ts`.
- **Self-hosted static images are permitted** under `public/chomp/`, referenced through `asset()` so they carry the basePath and the cache-busting build stamp. Everything else is drawn procedurally. *Amended 2026-08-03: this rule originally read "zero external assets", which also banned images we host ourselves — not the intent. The thing being protected is that the page makes no third-party request and nothing can go missing at runtime, not that pixels may never come from a file.*
  - **Size budget: 500 KB total for `public/chomp/`, and 300 KB for any single file.** A game route that costs more than a couple of photos to load has lost the plot, and the budget is small enough that exceeding it is a decision rather than an accident. Prefer WebP. Decode asynchronously and render a solid fallback until the image is ready — first paint never waits on an image.
  - Fonts, scripts and any CDN-hosted asset remain **forbidden**, self-hosted or not: the site's faces come from `next/font` and are already self-hosted at build time.
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

**How a tile is drawn is isolated entirely within `render.ts`, and the strategy is
decided: native resolution.** Pick the largest whole-pixel tile that fits the viewport and
draw anti-aliased at that size. It stays crisp at any DPR, avoids the thick letterbox bars
integer scaling produces on odd viewports, and sits closer to the rest of the site's
procedural-canvas look (`riceBowlEngine.ts`, `GrainCatch.tsx`).

*Amended 2026-08-03: pixel-art mode — a locked 224×248 buffer, an 8px sprite atlas,
`imageSmoothingEnabled = false`, nearest-neighbour upscale — was briefly recorded as a
supported alternative pending a look at four pests in motion. It is now **removed**, not
deferred: the wall treatment uses a photographic paddy texture, and a photograph
nearest-neighboured into a 224-pixel-wide buffer is not a style, it is a mistake. The two
decisions are incompatible, and the background is the one being kept. Native resolution is
therefore a decision, not a default — do not reintroduce a pixel-art path.*

### Path handling

`basePath` is `""` in production — the site owns its own domain and assets serve from the root with no prefix. **Never hardcode a path prefix, in TS or in CSS.** Use the same env-driven mechanism the rest of the app uses, or root-relative paths, so a future basePath change is one edit. The `/onegrainofrice/...` cursor URL in `globals.css` is exactly the bug this rule exists to prevent.

### Testability

`vitest` here is node-env and DOM-free by design. Maze parsing, per-pest target-tile selection, junction tiebreak, mode-cycle timing and scoring must be pure functions, importable without a DOM, and unit tested. The render layer can stay untested. `noUncheckedIndexedAccess` is off, so bounds-guard every tile lookup by hand.

Suites: `test/chomp-{maze,movement,pests,cornering,levels,kiting}.test.ts`.

**The bot is part of the test suite, not a throwaway.** *Added 2026-08-04.* `test/chomp-support.ts` holds a playing bot — breadth-first danger field, one-tile-ahead decisions so it corners like a person, scored by how much of the maze it can still reach before the pests cut it off. `test/chomp-kiting.test.ts` uses it to answer questions the geometry can only half-answer: whether any loop can be orbited forever, and whether a room can be sealed. Two rules learned the hard way and worth keeping:

- **A bot that dithers is a bot bug, not a maze verdict.** The first version re-decided every tile and spent whole runs oscillating between two adjacent tiles, which made the maze look far more lethal than it is. It commits in corridors and only re-decides at junctions.
- **Check the check.** A bot that dies because it cannot see far enough looks exactly like a maze that cannot be farmed. The suite re-runs the conclusion at double the lookahead; if that rescued it, the finding was about the bot.
- **Re-ask the question after every change to the curve.** *Added 2026-08-04, Phase 4.* A maze that cannot be farmed at level 1 is not automatically safe at level 9: the speed multipliers move every quantity the level-1 answer depended on. The kiting suite runs at levels 1, 5 and 9 — pests slower than the player, level with them, and faster.
- **Prefer arithmetic to a bot where the question has an exact answer.** Whether cornering still pays at level 21 is not a thing to measure by running a chase and counting seconds; a chase is chaotic and single runs disagree with each other. It is a break-even ratio, and it is computed. The bot is for questions that are genuinely about search and pursuit.

## The maze

- 28 columns × 31 rows on the logical 8-unit tile grid (see *Tile grid vs render strategy*).
- Original symmetrical layout, warp tunnel on the left and right edges, central pen, no unfair dead ends, fully connected under warp-aware flood fill.
- Enough cross-connections that the maze is a network of loops, not parallel shafts — but no loop so long or so well-connected that all four pests can be kited around it indefinitely. **Measured in Phase 3, not assumed:** `test/chomp-kiting.test.ts` drives a bot that reads the whole board and runs wherever there is most room, and it dies every time. See *Testability*.
- **No room the player can be sealed into by two pests.** Every corridor is one tile wide, so a pest standing on a way out is a closed door; a room with two ways out is therefore a box that two pests can shut. *Added 2026-08-04: the bottom-centre room the player SPAWNS in had exactly two, both on row 29. Row 24 cols 10 and 17 were opened to take it to four. The girth is unchanged at 10 and there are still no 2×2 open blocks outside the pen.*
- **Girth (shortest cycle) is 10, and no corridor is two tiles wide.** A 2-wide region lets pests pass each other and lets the player sidestep, which breaks pursuit outright. Both are asserted in `test/chomp-maze.test.ts`, over the tiles the player can actually **reach** — the pen is a 6×3 room, and including it reports a girth of 4 about a room nobody can enter.
- Stored as a string array map, easy to edit, structured so additional layouts can be dropped in per level.
- Tile types: wall, path, grain, golden grain, pen door, tunnel, empty.

## The player

- **A single grain of rice** — the site's own motif — with a mouth animating open/closed and facing the direction of travel. *Amended 2026-08-03: this originally said a rice bowl. A bowl travelling down a corridor eating loose grains is a strange object, the single grain is already the site's motif, and a grain eating grains is the joke a $RICE game wants.*
- **The player grain must be unmistakable against the pellet grains at a glance** — in peripheral vision, mid-panic, not on careful inspection. Size, outline, colour from the theme block and the animating mouth all have to be doing work. If there is any moment where the player loses track of which grain they are, this has failed. **Verify on a phone screen, not a desktop one.**
- **The hat is the distinctness feature, and its outline is what does the work.** The player wears a conical farmer's hat: khaki straw, a lighter brim, and the whole silhouette outlined in olive-deep. The pellet grains are flat khaki with no stroke, so a hard dark edge is the one property the player has that nothing else on the board does — the tan alone is not enough, because it is the same tan. The hat must never overlap the mouth cone: the mouth is a notch cut out of the body, so anything drawn across it fills the gap and reads as a shut mouth even without touching the outline.
- **Orientation is one sprite plus a transform.** The base sprite faces **RIGHT** — mouth opens rightward, eye above the mouth, hat on top of the head. The four facings are transforms of that one sprite, applied to the whole character:
  - `RIGHT` no transform
  - `LEFT` horizontal mirror, `scale(-1, 1)` — **not** a 180° rotation, so the grain stays upright with the hat on top and the eye above the mouth
  - `UP` rotate 90° counter-clockwise
  - `DOWN` rotate 90° clockwise

  **The hat is attached to the character, not to the screen.** Going UP the hat therefore points screen-left and the eye sits left of the mouth; going DOWN the hat points screen-right. That is intended and must not be "fixed" — a body leaning one way under a hat counter-rotated the other way reads as broken. *Amended 2026-08-04: this replaces a per-facing placement table that positioned the hat and eye in screen space. That approach needed a special inverted-cone hat for UP, because with the mouth opening through the top of the frame there was no room left above the head. Under a single-sprite transform the mouth only ever opens through the sprite's own right-hand side, which is never where the hat is, so the hat and the mouth cone can no longer compete for space at any facing and the UP special case is deleted rather than worked around.*
- Grid-aligned movement with a **queued turn buffer**: a direction pressed before a junction is taken the instant it becomes legal. This is what makes the genre feel good — it is not optional.
- **CORNERING is the skill ceiling, and it is a mechanic, not a feel.** A turn keyed *early* — up to `cornerLead` subunits before the junction centre — does not wait for the centre. The player glides diagonally through the corner, advancing on both axes at once, and leaves the junction having skipped that much path. A turn keyed *late*, within `turnTolerance` past the centre, is still accepted but glides backwards and pays the same distance instead of banking it. **Pests cannot do this: they turn only on exact tile centres.** So every corner taken early is real distance bought off a pursuer, and it compounds — a four-corner loop is a tile and a third per lap, measured. *Added 2026-08-04, Phase 3.*
  - **`cornerLead` and `turnTolerance` are separate dials and must stay separate.** Widening the tolerance to chase a better cornering feel is the classic mistake: it produces the same symptom (turns take more readily) and none of the benefit (a late turn still costs you the corner). `turnTolerance` is late-input forgiveness only. Both live in `levels.ts`, and `test/chomp-cornering.test.ts` pins them apart.
  - The whole glide is contained inside one tile, so it can never clip a wall, skip a grain, or enter a tile the turn did not check.
- **Faster than the pests early, slower than them late.** The player's speed is flat across levels and the pests ramp past it — the crossover is around level 7, and by the top of the table a pest is 6% faster on open path. That is the difficulty curve, and it is why cornering exists: once a pest is faster on open path, the corner is the only place a player can still gain. *Amended 2026-08-04: this originally said "slightly faster than the pests on open path" without qualification, which describes level 1 and nothing after it. The crossover was "around level 13" until the Phase 4 curve was measured; it is level 7.*
- **The speed curve is capped by cornering, not by taste.** *Added 2026-08-04, Phase 4.* Round a loop `L` tiles long with four corners, a perfect corner-cutter travels `L·SUB − 4·cornerLead` while the pest behind them must travel the full `L·SUB`, so per lap the player nets `L·SUB − r·(L·SUB − 4·cornerLead)` where `r` is the pest/player speed ratio. That is zero at `r* = L·SUB / (L·SUB − 4·cornerLead)`. The consequence is the shape of the whole endgame:
  - the **girth-10 ring** breaks even at `r* = 1.15`, which the curve never approaches — a perfect player can hold the tight loops at any level, and those are the loops with the most junctions on them, so holding one is not safety;
  - the **22-tile spawn loop** breaks even at `1.065`, and the pest table tops out at `1.0625` — deliberately just under;
  - the **32-tile pen loop** breaks even at `1.043`, which the curve passes around level 15 — from there, perfect cornering no longer holds the big loop.

  So the set of loops a perfect player can hold **shrinks** as the levels climb, toward the tightest and most heavily pincered ones. **Raising the top of the pest speed table past `r* = 1.065` breaks this**, and `test/chomp-levels.test.ts` asserts it so that would be a decision rather than an accident. The margin is **0.19%** — 1.0625 against a break-even of 1.0645 — and the test asserts the margin itself, not just the inequality.
- **The crossover is a named, revertible decision.** *Added 2026-08-04.* Pests overtaking the player is a bigger lever than "the pests ramp up" suggests: the reference game never lets a pursuer exceed the player's open-corridor speed, so a perfect player can always escape in a straight line, and the pressure comes from the eating freeze and the shrinking frightened window instead. Here, past the crossover, straight corridors stop being an escape and cornering becomes the player's only resource. The loop maths above says that is still enough — but only for a perfect player, so the decision is carried in code as three named constants in `levels.ts` rather than as a shape buried in a table of numbers:
  - `PEST_CROSSOVER_LEVEL = 7` — parity at 7, strictly faster from 8. Asserted against the table.
  - `PEST_TOP_RATIO = 1.0625` — the top of the table as a multiple of player speed. Asserted against the table.
  - `PEST_RATIO_CAP` — **the revert lever.** A ceiling applied after the table lookup. At `PEST_TOP_RATIO` it changes nothing; set it below 1 and the curve becomes strictly-slower-pests, with every entry above the ceiling flattened onto it and the early levels untouched. One edit in `levels.ts`, if levels 7+ read as unfair rather than hard — *corrected 2026-08-04: it is one edit in the engine, but six tests in `test/chomp-levels.test.ts` then fail, because they assert the crossover exists. That is the alarm working, not breakage; reverting means re-pointing those six.*
- **Eating costs whole frozen ticks, not a reduced speed:** 1 tick of no movement per grain, 3 ticks per golden grain. *Amended 2026-08-03: this originally said "slightly slower while chomping grains". A blanket eating-speed value does not produce the same texture — the freeze is the mechanism that lets a pursuer close real distance on a player clearing a fresh corridor, and it is the reason the genre's chases tighten where the grains are thickest. There is no separate eating-speed dial; the freeze counts live in `levels.ts` with every other tuning number.*
- 3 lives, extra life at 10,000 points.

## The pests

1. **Rat** — direct pursuit: targets the player's current tile.
2. **Sparrow** — ambusher: targets 4 tiles ahead of the player's facing direction.
3. **Weevil** — flanker: take the tile **2 ahead of the player's facing** as a pivot, then **double the vector from the Rat to that pivot**. Target = `2 × pivot − rat`. It swings wide when the Rat is far and pinches tight when the Rat is close, so the two of them cover both ends of a corridor without either being told to. *Amended 2026-08-04: this originally read "a tile derived from the player's position mirrored through the Rat's position". Read literally that is `2 × rat − player`, which puts the target on the far side of the Rat from the player — i.e. behind them whenever the Rat is chasing — and sends the flanker away from the fight. The formula above is what "flanker" means and is what is implemented; `test/chomp-pests.test.ts` pins the direction so the literal reading cannot creep back.*
4. **Locust** — skittish: pursues directly when far from the player, retreats to its scatter corner within 8 tiles.

Shared behavior:

- Never reverse direction except on a mode change.
- At each junction, choose the legal direction minimizing Euclidean distance to the current target tile, tiebreak order up / left / down / right. Distances are compared **squared** (monotonic, so it changes no decision, and it keeps the AI in integer arithmetic) and are **warp-blind** — the AI does not know the tunnel joins the two edges of the maze, which is what makes the tunnel an escape route rather than a corridor with extra steps.
- **Pests turn only on exact tile centres.** This is the asymmetry cornering is built on; see *The player*.
- Mode cycle per level: scatter → chase → scatter → chase, scatter phases shortening as levels progress. Each pest has its own scatter corner, and all four are **real corridor tiles** rather than off-board points, so a pest that reaches its corner circles it instead of jamming into a wall. The cycle clock **pauses while a power window is open**, so using a golden grain never silently costs the player a scatter phase.
- Frightened mode on golden grain: pale, slowed, semi-random at junctions from a **seeded** PRNG — never `Math.random()`, because the run has to replay. Frightened is per-pest, not global: one eaten mid-window comes back as itself and hunts while its siblings are still fleeing.
- Eaten pests become eyes that route back to the pen and respawn. Eyes follow a **precomputed breadth-first field**, not the greedy junction rule — greedy pursuit of a fixed point can stall in a local minimum, and an eye that never gets home is a pest that never comes back.
- Pen exit on a dot counter plus timer, staggered so all four don't emerge together. The Rat starts outside; the other three wait.

### Legibility — four silhouettes, not four colours

*Added 2026-08-04, Phase 3, for the same reason the player has a hat.*

A textured paddy background is coming in Phase 4+, and colour alone will not survive it — nor will it survive a colourblind player, or a phone in sunlight. **Each pest is built around one outline feature that reads in monochrome**, and every one is stroked in nori so its shape holds an edge against whatever ends up behind it:

- **Rat** — two round ears proud of the head, and a long bare tail. Low, long body.
- **Sparrow** — a hard wedge beak and a fanned tail kicked up behind. Plump and round.
- **Weevil** — a wide low domed shell with a seam, and a long down-curving snout.
- **Locust** — a Z-kinked jumping leg standing above the back, and long antennae. Narrow body.

**Orientation differs from the player's rule, deliberately.** The player is one right-facing sprite rotated bodily, which works because a grain of rice reads at any angle. A rat rotated 90° does not read as a rat. Pests therefore stay upright, mirror horizontally to face left, lean slightly into a vertical move, and show direction with **where the eye is looking** rather than by turning the body.

### Legibility — six bonus items, same rule

*Added 2026-08-04, Phase 4. A harder version of the pest problem: these are ONE tile — about 27px on a desktop and less on a phone — they are on screen for nine seconds, and the player is reading them out of the corner of an eye while being chased. Anything that needs a second look has already failed.*

Each is built from one unmistakable outline property, so the six read apart in monochrome:

- **Soy sauce** — a NECK. Tall body, hard shoulder, narrow throat, cap on top.
- **Chopsticks** — two thin DIAGONALS with daylight between them. The only item that is not a single solid mass, and the only one made of straight lines.
- **Nori** — a wide sheet with a CURLED CORNER. The curl is load-bearing: a plain rectangle and a trapezoid are the same shape at this size, so the sheet gets a rolled corner and the cup keeps its foot.
- **Sake cup** — a FOOT. Flared bowl on a pedestal, with an open elliptical rim.
- **Chili** — a CURVE, and the stem is kinked *against* the bend of the pod so the two curves do not merge into one blob.
- **Sesame** — THREE separate seeds. The only item that is not a single object.

**Colour is the second channel, not the first.** Nori is bamboo green rather than black, because a black sheet on a black corridor is not a sheet, it is a hole.

**The HUD level indicator is the cheapest test of all this.** It draws the run of items earned so far, at 22px, side by side, through the *same* `drawBonusItem` the board uses — so recognising an icon teaches the player the thing that will appear under the pen, and any two items that are confusable show up there first.

## Scoring and progression

- Grain 10, golden grain 50, pest chain 200/400/800/1600 within a single power window.
- Bonus items appear twice per level for ~9 seconds: soy sauce bottle, chopsticks, nori sheet, sake cup, chili, sesame — escalating values by level. *Amended 2026-08-04, Phase 4, with two things the original line left open:*
  - **They appear on a DOT COUNTER, not a timer** — at 70 and 170 grains cleared this level. That makes an item a reward for clearing rather than for surviving, so a player hiding in a corner never sees one. The counter is per LEVEL, not per life: dying should not cost you an item you had nearly earned. The item already on the board *does* go with the life that was chasing it.
  - **"Maze center" is the corridor under the pen** — row 18, straddling cols 13/14. The literal centre of a 28×31 maze is row 15, which is *inside the pen*, where the player cannot go. Row 18 is the genre-correct spot: dead centre horizontally, one corridor below the gate, and reaching it costs position in the middle of the board.
- Level completes when all grains are cleared → maze flash → next level, faster pests, shorter frightened duration.
- **Frightened mode fades out rather than being switched off.** *Amended 2026-08-04: the original line read "From level 5 frightened mode is eventually disabled entirely", which has two readings — level 5 is where the shrinking starts to bite, or level 5 is where it is already gone. The first is implemented: level 5 is a 2-second window (already vestigial), and `FRIGHTENED_GONE_FROM_LEVEL` in `levels.ts` is where it goes to zero for good. The reasoning is on that constant, and switching to the other reading is that one number plus the tail of one table.* The fade is not monotonic — levels 6, 10 and 14 hand back a long window, because a pure slide gives the player nothing to look forward to and those levels are where a run earns its chain points.
- Interstitial cutscenes after levels 2 and 5, under 4 seconds, **skippable by any key or any touch**. *Amended 2026-08-04: the beat was described as "rat steals a grain, bowl chases it off-screen"; the player has not been a bowl since Phase 2. The pair now reads as a debt and its repayment — the Rat hauls a stolen grain off with the player in pursuit and not gaining, then after level 5 the player comes back the other way with the Rat running. Both are drawn from the same sprite functions the game uses, so a cutscene is two positions and a caption rather than any new art.*
  - **A cutscene consumes NO simulation ticks.** The phase freezes the run completely and the host animates on its own clock. This is load-bearing rather than tidy: the input trace is tick-stamped, so if watching or skipping changed how many ticks elapsed, whether the player pressed skip would shift every later event and server-side replay would no longer line up. Watched, skipped, or never drawn at all, the run is bit-identical.
- **Every tuning number** — speeds, timers, mode durations, score values, the per-grain eating freeze, and the two movement dials (`cornerLead`, `turnTolerance`) — lives in `levels.ts`. No magic numbers in engine code. *Amended 2026-08-04: `levels.ts` now exists, and the two constants Phase 2 kept in `engine/game.ts` have moved into it. `game.ts` re-exports them as a compatibility seam and nothing else.* Speeds are authored in tiles/second and durations in seconds, converted once at module load; everything the simulation reads is an integer, because the simulation is replayed server-side and floats do not replay.

## Controls

- Keyboard: arrows and WASD. `P` or `Esc` pauses, `M` mutes.
- Touch: swipe and an optional on-screen d-pad, both available, d-pad toggleable. Portrait letterbox; never force or nag about rotation. Must be genuinely playable one-thumbed in portrait.
- Gamepad API if it's cheap; skip it if it isn't.

## UI and presentation

- Attract screen: title, pests introduced one at a time, high scores, start prompt.
- HUD: score, high score, level indicator as bonus-item icons, lives as small bowl icons. *The bonus-item level indicator landed in Phase 4 (`BonusIcons.tsx`); score, high score and the lives row are still Phase 6.*
- Game over → name entry → submission → leaderboard.
- **`/chomp?level=N` starts a run partway up the curve, and that run can never be a score.** *Added 2026-08-04.* The only debug affordance, and it exists because the tail of the difficulty curve has to be felt rather than argued about. Two independent things stop it counting, because one guard on a cheat path is not a guard: the run carries `startLevel` and `isScoreSubmittable()` is false for its whole life (Phase 7's leaderboard must gate on it, client and server), and a trace recorded from level 7 fails server-side replay from level 1 anyway. It is also visible — the HUD shows a `DEBUG · from N` chip and the game-over card says the score is not a score.
- `prefers-reduced-motion`: strip screen shake, maze flash and cutscenes; **gameplay stays playable**. *Amended 2026-08-04 with what "strip" means here: the maze-clear phase still runs for exactly the same number of ticks but the strobe is not drawn, and the interstitial is dismissed before its first frame. Both are presentation-only, so a reduced-motion run and a normal run are tick-for-tick identical — the preference changes what is painted and never what is simulated.*
- **High-contrast toggle (Phase 6).** Plain wall fill, no background image, for anyone who finds the textured board hard to read. Persisted alongside the mute setting, and reachable without starting a game. *Added 2026-08-03 with the paddy wall texture: a decorative background that some players cannot read is a decorative background with an off switch, not a reason to skip the decoration.*

### The board (Phase 4 and later)

- **Walls carry the paddy texture, corridors do not.** A self-hosted rice-field image is clipped to the wall shapes — flooded paddies with the walkways cut between them. Corridors stay dark and uniform so grains, player and pests pop off them.
- Darken the image **40–60%**, tuned by eye against four pests in motion.
- **Stroke the wall edges in a theme colour.** This is the line item that decides whether the treatment works: a textured maze without edge definition is soup.
- **Bake once into an offscreen canvas at boot**, never per frame. Re-bake only on a size change, alongside the existing static layers.
- **Decode asynchronously.** The maze renders on a solid fill until the image is ready; first paint never blocks on it, and a failed load is a non-event.
- **Legibility beats theming.** If it cannot be made readable with four pests on screen, desaturate it to near-texture or drop it outright.
- **Golden grains are stylized paddies** — flooded field, a few rows of shoots, high contrast — drawn procedurally, not downscaled from a photo: a tile is ~27px and detail below about 24px dies. They carry a slow pulse or shimmer so they separate from ordinary grains by **motion as well as shape**.

## Leaderboard

- Separate `data/chomp.db` via HTTP API routes, with the Next process as sole writer. The grains WS process keeps its single-writer contract untouched.
- `better-sqlite3`, WAL, idempotent `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` guards, matching the grains pattern. Set `PRAGMA wal_autocheckpoint` explicitly.
- Country attribution reuses the existing nginx GeoIP headers verbatim — no nginx change.
- Identity: `grain_vid` cookie for dedupe and rate limiting; display name entered per submission, prefilled from the grains board name if present. 3–12 chars, sanitized, profanity-filtered.
- Submission payload: name, score, level reached, duration, grains eaten, pests eaten, bonuses collected, and a compressed input trace.
- Validation, server-side, trusting nothing from the client: rate limit per `grain_vid` and per IP; reject scores above a plausible ceiling for the reported level and duration; reject impossibly short runs; verify score is arithmetically consistent with the reported event counts. Store the input trace unverified so replay validation can be added later as a server-side change only. Document in comments what this does not catch.
- Views: global top 100, per-country top 100, personal best in `localStorage`.

### Pattern-ability, and what it means for the board

*Recorded 2026-08-04.* The simulation is deterministic by design, and the seeded PRNG only
bites once a power window opens — frightened pests are the sole consumer of randomness.
Measured consequence: driving the same bot at level 1 across five different seeds produced
an **identical first life, to the tick — 48.6 seconds every time**, and an identical third
life at 18.0 seconds.

This is genre-accurate and mostly desirable. The reference game is famously pattern-able,
and learnable patterns are a large part of why players return to it. It is written down
here because it has a second face: **a memorised route is repeatable, and a repeatable
route is farmable.** If the leaderboard ever fills with near-identical scores, or with
runs whose input traces are near-identical, this is the reason — not a bug in validation,
and not necessarily cheating either. A player executing a learned pattern perfectly is
playing the game as designed.

The remedies, in the order they should be reached for, none of them yet needed:

1. Do nothing. Pattern play is legitimate, and a leaderboard of skilled repeat runs is a
   working leaderboard.
2. Rank by best run per player rather than by run, so a pattern farmed a hundred times
   occupies one row instead of a hundred.
3. Seed the PRNG per run from something the client cannot choose, and submit the seed with
   the trace. Replay verification already needs the seed, so this costs nothing extra —
   but it makes patterns less reliable, which is a real loss, so it is the last resort and
   not the first.

Do NOT reach for "add randomness to pest movement". It would break determinism, and
determinism is what replay verification is built on.

## Acceptance criteria

- 60fps on a mid-range phone; no GC stutter — pool objects, no per-frame allocations in the hot loop.
- Deterministic: identical inputs produce an identical run regardless of frame rate.
- Zero third-party network requests, verified in the network tab. Self-hosted images under `public/chomp/` are within budget (500 KB total, 300 KB per file).
- Zero new npm dependencies.
- Fully playable keyboard-only and touch-only.
- No hardcoded path prefixes anywhere, TS or CSS.
- Pure-logic modules unit tested under the existing DOM-free vitest setup.
- **Level 1 is completable.** Its job is to teach the maze; a player who cannot finish it never sees the game. Asserted in `test/chomp-difficulty.test.ts`, which clears the board on every seed in about a minute with lives still in hand. *Added 2026-08-04.*
  - The bot used there heads for grains and refuses steps a pest reaches first. It is **not** the kiting suite's bot, which maximises safe space and will happily circle an already-eaten corridor forever — measured with that one, level 1 looked unclearable at every pest speed down to 75% of the player's, a finding entirely about the bot. Any future claim that the difficulty curve is wrong has to come from an instrument that is trying to do the thing being measured.
- The grains game and its WS process are untouched and still working.
