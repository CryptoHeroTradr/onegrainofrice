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
  - **EVERY NEW SITE-WIDE PROVIDER MUST BE CHECKED AGAINST `src/lib/playSurfaces.ts`.** *Added 2026-08-04, Phase 5.* Four providers mounted in `app/layout.tsx` are now scoped off `/chomp` through that one list — the chopstick cursor, the Konami rice dump, the rice-particle field and page translation — and the fourth is the instructive one. The first three were scoped off because they fight a maze game: they hide the cursor, listen on `window` for keys that are now primary game controls, and drape grains over the play area. **Translation was scoped off because its script was the only thing standing between this route and the acceptance criterion above.** That is the general lesson: anything added to `layout.tsx` is added to the games too, the cost is invisible in `layout.tsx` itself, and nobody finds it by reading the file — it is found by building the page and measuring it. Ask the question when the provider is added, not a phase later.
- **Self-hosted static images are permitted** under `public/chomp/`, referenced through `asset()` so they carry the basePath and the cache-busting build stamp. Everything else is drawn procedurally. *Amended 2026-08-03: this rule originally read "zero external assets", which also banned images we host ourselves — not the intent. The thing being protected is that the page makes no third-party request and nothing can go missing at runtime, not that pixels may never come from a file.*
  - **Size budget: 500 KB total for `public/chomp/`, and 300 KB for any single file.** A game route that costs more than a couple of photos to load has lost the plot, and the budget is small enough that exceeding it is a decision rather than an accident. Prefer WebP. Decode asynchronously and render a solid fallback until the image is ready — first paint never waits on an image.
    - **Video is permitted under the same rule**, and Phase 5.5 added one. *Amended 2026-08-04: this said "images", which was the only kind of file anyone had in mind at the time. The constraint being protected is bytes and third-party requests, and a self-hosted MP4 is subject to exactly the same two.*
    - **Live as of 2026-08-04, Phase 5.5: 316 KB of 500 KB, in two files** — `paddy-wall.webp` 242 KB and `rice.mp4` 67 KB. **Both source files arrived over budget and neither shipped as delivered:** the background was a 3.12 MB PNG, ten times the per-file cap, and the video was 363 KB *and encoded `yuv420p10le`*. The second is the instructive one — 10-bit H.264 is a format Safari refuses, and a video that silently fails to decode on iOS looks exactly like one that is merely slow to start, so it would have shipped and looked fine on every machine it was tested on. **Check the pixel format, not just the codec and the byte count.** Re-encoded to 8-bit `yuv420p` at 320×320, which is about what a 6-tile-wide pit shows at DPR 2.
    - The budget applies to what is SERVED, and `public/` is served wholesale — so an oversized original left sitting beside its optimised version is still shipped to every visitor. Removing it is part of the conversion, not tidying afterwards. Both originals are kept outside the repo.
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

Suites: `test/chomp-{maze,movement,pests,cornering,levels,kiting,difficulty,audio,board,score}.test.ts`,
plus `test/canvas2d-shim.ts` and its own `canvas2d-shim.test.ts`.

**`chomp-score.test.ts` is the leaderboard's server side** (*added 2026-08-05, Phase 6*):
the trace codec, the run validator and the name rules, all of them pure and all of them
testable without a DOM or a database. Two things about it are deliberate. It checks the
validator against a run a BOT ACTUALLY PLAYED, and at forty points along that run rather
than only at the end — a validator tested against its own author's idea of a run is a
validator that rejects players. And it asserts that a decoded trace **replays to the same
score**, which is the anti-cheat bet stated as a test rather than as an intention.

**`chomp-board.test.ts` is the exception to "the render layer can stay untested", and it
was bought the hard way.** *Added 2026-08-04, Phase 5.5.* The render layer having no tests
is what let a wall texture ship that produced a board pixel-identical to the untextured
one. The shim is deliberately small — scale and translate, `source-over` and
`destination-in`, rect paths, no text rasterisation — and it is NOT a licence to test
painting in general. It exists so that a **baked** layer, which is a pure function from a
grid to pixels, can be asserted on its output.

**`chomp-audio.test.ts` is the host-boundary suite, not a sound suite.** *Added
2026-08-04, Phase 5.* It owns the assertion that everything on the host side of the
line — audio, the attract screen, the pause and game-over screens, the toggles, swipe
and the d-pad — cannot reach the simulation. Sound is handed the live state through a
proxy that throws on any write; a listened-to run is compared tick-for-tick against a
silent one; pausing is modelled as "the host stopped calling `tick()`" and asserted to
change nothing; and no module under `engine/` may import React, the DOM, `@/lib/sound`,
a clock or `Math.random` (`render.ts` is exempt from the DOM rule only, because it
paints and is never replayed). *Phase 5.5 added the board decorations to the same list,
because they are the same argument in a new costume: no engine module may mention a
video, `render.ts` may not create one or set a `src` or call `play()`, and no engine
module may import `asset()` — the host hands in a decoded image and an element, or hands
in nothing, and the run is identical either way.* *Phase 6 added the LEADERBOARD to the
same list, and it is the most tempting of the four: the numbers a board wants — score,
level, grains, pests, the trace — are all sitting right there on the state, and the
one-line version is an import of the submission module inside `finishDeath()`. So no
engine module may name the leaderboard, its wire types, its database or its trace codec,
none may call `fetch` or touch `localStorage`, `summarizeRun()` is held to the same
write-trapping proxy the audio cues are, and a run that is read, encoded and submitted is
tick-for-tick the run that is not.* That last one is the structural version of the whole
argument and the one that would silently rot: wiring sound up from inside `consume()`
is a one-line change that works perfectly in a browser and throws on the server the
first time a replay eats a grain.

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
- **Girth (shortest cycle) is 10, and no corridor is two tiles wide.** A 2-wide region lets pests pass each other and lets the player sidestep, which breaks pursuit outright. Both are asserted in `test/chomp-maze.test.ts`, over the tiles the player can actually **reach** — the pen is a 6×4 room, and including it reports a girth of 4 about a room nobody can enter.
- **The pen interior is 6×4 — cols 11–16, rows 13–16 — and the wall between it and the row-18 corridor is ONE row (row 17).** *Amended 2026-08-04, Phase 5.5; it was 6×3 over rows 13–15 with a two-row wall band at rows 16–17.* The pit was made a row taller to give the backdrop image (see *The board*) a rect worth looking at. It is recorded here because it looks like a maze change and is not one: the six tiles that changed were wall enclosed on every side by the pen's own walls, so they joined the sealed room rather than the corridor network. **Every property this file states about the maze is measured over player-reachable tiles, and that set did not change by a single tile** — 282 grains + 4 golden, girth 10, no 2×2 open block outside the pen, no dead ends, full warp-aware connectivity, four ways out of the spawn pocket, all re-run and all identical. The pest graph gained exactly those six tiles (326 → 332) and the eyes' route field did not see them at all, because it is built pen-blind. Both bots were re-run at levels 1, 5 and 9 and agreed to the tick with their pre-change figures. **The pit grew DOWNWARD deliberately:** `PEN_LANE_ROW` stays at 14, so the glide from a pest's slot to the gate is the same distance and the staggered release keeps its exact tick timing. Growing it upward would have moved the gate, and the gate's row is what every exit timing and the eyes' BFS target are measured from.
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

  *Ratified 2026-08-04, with the reason the amendment above was missing.* The choice is not merely procedural. **The chain is the only offensive move in the game.** Everything else the player has — cornering, the loops, the tunnel — is evasion. Switching frightened mode off at level 5 would leave twelve levels in which the player can never do anything but run, and a game whose middle is pure evasion has no second act. Ending it at 17, with reprieves at 6, 10 and 14, keeps a reason to still be playing at level 12. If anyone is ever tempted back to the other reading by the original brief's wording: the brief was the sloppy artifact, not this file.
- Interstitial cutscenes after levels 2 and 5, under 4 seconds, **skippable by any key or any touch**. *Amended 2026-08-04: the beat was described as "rat steals a grain, bowl chases it off-screen"; the player has not been a bowl since Phase 2. The pair now reads as a debt and its repayment — the Rat hauls a stolen grain off with the player in pursuit and not gaining, then after level 5 the player comes back the other way with the Rat running. Both are drawn from the same sprite functions the game uses, so a cutscene is two positions and a caption rather than any new art.*
  - **A cutscene consumes NO simulation ticks.** The phase freezes the run completely and the host animates on its own clock. This is load-bearing rather than tidy: the input trace is tick-stamped, so if watching or skipping changed how many ticks elapsed, whether the player pressed skip would shift every later event and server-side replay would no longer line up. Watched, skipped, or never drawn at all, the run is bit-identical.
- **Every tuning number** — speeds, timers, mode durations, score values, the per-grain eating freeze, and the two movement dials (`cornerLead`, `turnTolerance`) — lives in `levels.ts`. No magic numbers in engine code. *Amended 2026-08-04: `levels.ts` now exists, and the two constants Phase 2 kept in `engine/game.ts` have moved into it. `game.ts` re-exports them as a compatibility seam and nothing else.* Speeds are authored in tiles/second and durations in seconds, converted once at module load; everything the simulation reads is an integer, because the simulation is replayed server-side and floats do not replay.

## Controls

- Keyboard: arrows and WASD. `P` or `Esc` pauses, `M` mutes.
- Touch: swipe and an optional on-screen d-pad, both available, d-pad toggleable. Portrait letterbox; never force or nag about rotation. Must be genuinely playable one-thumbed in portrait.
- Gamepad API if it's cheap; skip it if it isn't. *Not built, and not because it was hard: nothing else in the repo speaks to a gamepad, so it would be the only input path with no second user. Reconsider if anyone asks.*
- **Every input route ends at `setWanted()`.** *Added 2026-08-04, Phase 5.* Arrows, WASD, a swipe and a d-pad key are four ways of calling one function, and that is the property that keeps touch out of the input trace's business — a second entry point into the engine is a second thing server-side replay has to know about. `test/chomp-audio.test.ts` pins it.
- **The swipe RE-ANCHORS after every turn.** A drag registers a direction at 22 CSS pixels of travel and then resets its origin to where the thumb currently is, so one unbroken drag can trace a whole route — down, right, up — without lifting off. That is what "playable one-thumbed" means in a game whose skill is the corner: a scheme that needs a separate flick per turn cannot corner early, and cornering early is the entire skill ceiling. A lift with no turn in it is a TAP, which means "get on with it" — start the run, skip the interstitial.
- **A CONTROL WITH FOCUS OWNS `Space` AND `Enter`. IT NEVER OWNS THE STEERING KEYS.** *Added 2026-08-04, Phase 5.6, when the site nav put a bar of links on the page.* The window-level key handler cancels the default action of the keys it claims, which is right for the arrows (they scroll) and for WASD (browser quick-find) and must stay right for them **whatever has focus** — a link with focus can never stop the player steering. It is wrong for `Space` and `Enter`, because those are how a keyboard reaches a button or a link at all: a handler that cancels `Enter` makes every anchor on the page keyboard-dead.
  - The guard used to read `tagName === "BUTTON"`, which covered the overlays' own buttons and nothing else. **It was therefore already broken for the one link that was already on the page** — `Enter` on the focused "back to the paddy" link did nothing, on the shipped build, silently. Verified against it before the fix, then after. It is now `closest("a[href],button,[role='button'])`.
- **`M` drives the SITE's sound switch (`grains:sound`), not a private one.** There is one sound toggle on this site, and the chopstick cursor and the grains clicker already answer to it. A game-local mute would mean a player who muted the site still gets chomped at. The d-pad and contrast preferences ARE game-local (`chomp:dpad`, `chomp:contrast`) because nothing else on the site has an opinion about them.

## Sound

*Added 2026-08-04, Phase 5. Eight clips, synthesized by `scripts/gen-sfx.mjs` into
`public/sfx/chomp-*.wav` and played through `src/lib/sound.ts` — the same pipeline and
the same player as the grains clicker. 184 KB total, 16-bit mono at 22.05 kHz, no files
from outside the repo and no third-party request.*

- **Sound is DERIVED from the simulation, never emitted by it.** The obvious wiring is
  `playChomp()` inside `consume()`. That is exactly what must not happen: the run is
  replayed server-side by a Node process with no speakers, and an event queue on the
  state is state — allocated, appended to, drained by whoever is listening. So
  `engine/cues.ts` diffs two snapshots of counters the engine already keeps and infers
  what happened. It takes a readonly view, writes nothing, allocates nothing per tick,
  and could be deleted without changing a tick of any run.
- **The chomp is the one that matters, and it rests on four rules.** It fires up to
  eight times a second for a whole run, which is a different design problem from a
  sound heard twice a level. Any edit that breaks one of these undoes it:
  1. **Nothing above ~1.2 kHz.** Fatigue lives in repeated high-frequency transients.
     Measured: the two clips sit at a 338 Hz and 280 Hz spectral centroid with 2.3% and
     1.7% of their energy above 1.2 kHz.
  2. **No click.** A 4 ms attack ramp, not an instantaneous one. A click is inaudible
     once and unbearable four hundred times.
  3. **It ALTERNATES**, two clips a fourth apart, A B A B. One repeated sample is a
     repetition; two alternating pitches are a *rhythm*, and a rhythm is something an
     ear settles into instead of braces against. This is the single biggest factor and
     it is what the arcade original does.
  4. **It stops before it repeats.** `PLAYER_TILES_PER_SEC` is 8, so chomps are 125 ms
     apart; the clip is 55 ms and never overlaps itself. Overlapping copies of one
     sample is what turns a patter into a drone.
- **The pest chain rises in pitch** — two semitones per link off one sample via
  `playbackRate`, so the 200/400/800/1600 ladder is audible without four files, and the
  fourth one is a sound worth chasing.
- **Nothing plays before the player's first gesture, and the browser enforces that**
  rather than us: the AudioContext is created suspended and only the module's own
  first-gesture unlock resumes it. Since the game cannot start without a keypress or a
  tap, the attract screen is silent by construction.
- **Playback is fire-and-forget by contract.** Cues are dispatched from inside the
  fixed-timestep loop, so a call that blocked would stall the *simulation* — which is
  not a hitch but a divergence. Nothing is awaited, nothing throws to the caller, and a
  browser with no AudioContext, a failed decode and a muted player all cost the same.
- **The chomp clips are generated from a SEEDED PRNG**, so `pnpm gen:sfx chomp` is
  byte-for-byte a no-op. Regenerating a WAV rewrites every byte of a binary file in git,
  and the family filter (`pnpm gen:sfx chomp`) exists so the chomp set can be retuned
  without churning the grains clips, which are still drawn from `Math.random()`.

## UI and presentation

- Attract screen: title, pests introduced one at a time, high scores, start prompt. *Built in Phase 5, 2026-08-04, and it is DOM rather than canvas — a decision, not a shortcut. A canvas attract screen would be closer to the arcade and would also be text a screen reader cannot see, a Start button a keyboard cannot reach and a layout hand-measured at every viewport. The one thing that genuinely needs canvas — the four pests — is canvas, one small context per portrait through the same `drawPestIcon` the board uses, so the silhouettes a player is taught before the run are pixel-for-pixel the ones that will chase them. The high scores are the local board (see Leaderboard). Attract is a HOST FLAG, not a game phase: while it is up `tick()` is never called, and the run it starts is a brand new state, so nothing that happens on it can reach a run even in principle.*
- HUD: score, high score, level indicator as bonus-item icons, **lives as rice grains**. *The bonus-item level indicator landed in Phase 4 (`BonusIcons.tsx`). The lives row landed in Phase 5.5 (`LivesRow.tsx`) and is drawn through `drawPlayerIcon` — the SAME sprite code the board runs, hat and outline and all — for the reason the bonus strip routes through `drawBonusItem`: an icon drawn separately is an icon that drifts, and the one thing this character has to do is stay recognisable. It was `◆` glyphs until then; the spec said "small bowl icons", which is stale for the same reason the player is no longer a bowl. The high score is on the attract and game-over screens rather than the HUD, which is where a player actually reads it.*
- Game over → name entry → submission → leaderboard. *Phase 5 built the game-over screen itself: score, level reached as its bonus-item strip, where the run placed on the local board, Play again, and Title screen. **Name entry and submission landed in Phase 6** (`ChompSubmit.tsx`), and the ORDER on the card is the design: the number is on screen and read before anything asks the player to type. The block is absent entirely for a debug run and for a scoreless one — an input box offering to file a zero is worse than no box — and after a successful submit it says where the run placed and offers the board. It deliberately does NOT take a tap anywhere to dismiss the way the attract screen does — a stray thumb landing a moment after the death that caused it would wipe the score off the screen before it had been read.*
  - **The run is SNAPSHOT at the moment of death, not read at submit time.** `tick()` does nothing in the GAMEOVER phase but the tick counter is still incremented at the end of it, so a run read thirty seconds later claims eighteen hundred ticks it never played — a different duration and a different trace hash every time the player hesitated, which would also have defeated the submit-once dedupe.
- **The site's nav bar is on the game page, in a play-surface form.** *Added 2026-08-04, Phase 5.6.* `/chomp` is in `homeNavLinks` and was the one route on the site with no site chrome and a single text link out of it. It renders the SAME `JourneyNav` the rest of the site renders rather than a copy — a second bar would drift the first time the real one changed — and four things about it are forced by the game rather than chosen:
  - **It is IN FLOW, not `fixed`.** A game page is exactly one viewport tall and owns every pixel of it. A fixed bar would float over the board's own header while the board went on being sized as though the bar were not there.
  - **It is solid immediately.** The transparent-over-hero state resolves on scroll, and this page never scrolls, so it would sit in that state forever — a bar with no ground, over a black game.
  - **It is 56px at every width**, and it is hidden entirely below 520px of viewport height. On a landscape phone the bar is a fifth of what is left for the board and the page's own header link still leaves.
  - **It renders no `<LanguageSwitcher>`**, per the rule in the Acceptance criteria below: translation is scoped off play surfaces, so a language control there is a switch wired to nothing.

  **It costs board height, and that is the trade rather than a regression to fix.** Measured in the plan's §9: 27px tiles → 24px at 1080p, 39 → 35 at 1440p, 62 → 58 at 4K. **On a 390×844 portrait phone it costs nothing at all** — portrait is width-bound, so the bar comes out of vertical slack the letterbox was already wasting and the board is identical, tile for tile.
- **The game page's text is FLUID; the rest of the site's is not.** *Added 2026-08-04, Phase 5.6.* The HUD was authored in fixed px against a phone and stayed that size on a 27" monitor — an 8.8px label at 4K. The route's text now runs off `--text-chomp-*` in `globals.css`, one token per size the page already used so the mapping is 1:1 rather than a re-design. Two properties are the whole design and neither is cosmetic:
  - **The floor is exactly the size it replaces, and the ramp starts at 390px.** A portrait phone renders identically to before and nothing below it can shrink. Growth is one-directional, which is what makes this safe to apply to a layout with no room to spare.
  - **`vmin`, not `vw`.** The board is letterboxed into whatever the smaller axis leaves, so the smaller axis is what the chrome competes with. `vw` would blow the HUD up on an 844×390 landscape phone — the viewport with the least room — which is exactly backwards.

  The HUD's canvas icons (lives, the bonus strip, the attract portraits) ride the same ramp by being **drawn once at the top of it and CSS-scaled down**, so a viewport change never re-draws them and they are only ever downsampled. **This is DOM sizing only and touches no tile or letterbox maths** — the board has its own scaling and the two must stay independent.
- **"Back to the rice paddy" is ONE affordance in two places, never both.** *Added 2026-08-04, Phase 5.6.* On a wide landscape viewport it is a button against the right edge of the board area, just above the centre row, living in a gutter column the play row grows for it. Everywhere else — portrait, and any window narrow enough that the board would have to give up width for the gutter — it collapses into the header link that was already there. The breakpoints are exact complements, so there is never a second link saying the same thing, and the header link now points at `/home` like the button rather than at `/` (the grains game, still one row down the 🌾 Menu).
  - **The gutter columns are free only while the board is height-bound**, which is why they are gated on `landscape:` as well as width. The maze is 28:31, so on a landscape desktop the height runs out long before the width and the gutters are cut from margin that was already empty — measured, the tile size does not move. In portrait, width is the binding axis and the same gutters would come straight off the maze.
  - **Overlap with the canvas and with the tunnel mouths is impossible by construction, not avoided by an offset.** The button is in a different grid column from the board; there is no measurement to drift.
- **Pause is a screen, not a scrim.** *Added 2026-08-04, Phase 5.* Pause is where a player goes to change something, so the settings are on it rather than behind it, Resume is autofocused, and there is a way to abandon the run without reloading. Pausing costs the simulation nothing because it is not a feature of the simulation: the host stops calling `tick()` and stops feeding the accumulator, so no wall-clock is banked and no catch-up burst arrives on resume. That last clause is asserted, not assumed — a paused accumulator that kept accumulating would fire a burst of ticks on resume and diverge a run from a replay of its own trace.
- **`/chomp?level=N` starts a run partway up the curve, and that run can never be a score.** *Added 2026-08-04.* The only debug affordance, and it exists because the tail of the difficulty curve has to be felt rather than argued about. Three independent things stop it counting, because one guard on a cheat path is not a guard: the run carries `startLevel` and `isScoreSubmittable()` is false for its whole life, so the game-over card renders no submission block at all; the SERVER applies the same rule to the payload and answers 422 (`checkRun`, `startLevel !== 1`); and a trace recorded from level 7 fails server-side replay from level 1 anyway. *All three are built and tested as of Phase 6 — `test/chomp-audio.test.ts` for the client half, `test/chomp-score.test.ts` for the server half.* It is also visible — the HUD shows a `DEBUG · from N` chip and the game-over card says the score is not a score.
- `prefers-reduced-motion`: strip screen shake, maze flash and cutscenes; **gameplay stays playable**. *Amended 2026-08-04 with what "strip" means here: the maze-clear phase still runs for exactly the same number of ticks but the strobe is not drawn, and the interstitial is dismissed before its first frame. Both are presentation-only, so a reduced-motion run and a normal run are tick-for-tick identical — the preference changes what is painted and never what is simulated.*
- **High-contrast toggle.** Plain wall fill, no background image, for anyone who finds the textured board hard to read. Persisted alongside the mute setting, and reachable without starting a game. *Added 2026-08-03 with the paddy wall texture: a decorative background that some players cannot read is a decorative background with an off switch, not a reason to skip the decoration.* **Built in Phase 5, 2026-08-04** — this line said "(Phase 6)" and the work landed a phase early, alongside the rest of the accessibility pass. What it does, measured rather than described: ordinary walls are porcelain `#2a4d8f` on black, about **2.6:1**, which is decorative and genuinely hard to read; high contrast drops the wall fill to plain black and promotes the keyline that was decoration into the whole wall, bone `#f4efe2` at double thickness, about **18.3:1**. Grains go bone too, because khaki grains against a bone keyline is the one pair this change would otherwise make worse. **Nothing else is re-tinted** — the player's hat outline, the four pest silhouettes and the six bonus shapes were all built to read in monochrome already, and re-colouring them here would undo that work rather than add to it. It is a re-bake of the static layers and touches no gameplay.
  - The three switches — sound, contrast, d-pad — all sit in the screen's control bar, which is on screen *beside* the attract overlay rather than under it. Reachable without starting a game is the spec's ask about contrast and is the right rule for all three: someone who needs the high-contrast board needs it to read the attract screen's maze too.

### The board (Phase 4 and later)

*Built in Phase 5.5, 2026-08-04. The whole section below was written as a brief and is now
a description; the measurements are in `docs/rice-chomp-plan.md` §8.*

- **Walls carry the paddy texture, corridors do not.** A self-hosted rice-field image is clipped to the wall shapes — flooded paddies with the walkways cut between them. Corridors stay dark and uniform so grains, player and pests pop off them. *`public/chomp/paddy-wall.webp`, 1192×1320, 242 KB. Masked to the wall tiles with a `destination-in` composite on a scratch canvas rather than a 380-subpath clip.*
- Darken the image **40–60%**, tuned by eye against four pests in motion. *`TEXTURE_DARKEN = 0.52` in `render.ts`, one named number because it is the dial that gets tuned. Below ~0.45 the grass bunds start competing with the khaki grains; above ~0.6 the walls sink into the corridors and there was no point loading an image.*
- **Stroke the wall edges in a theme colour.** This is the line item that decides whether the treatment works: a textured maze without edge definition is soup. *Porcelain `#4571c4`, and on the textured board it is **thickened to 1.4×** (`TEXTURE_LIP_SCALE`). A flat fill needs a hairline to read as a slab; a photograph is busy, and the keyline stops being decoration and becomes the thing that says where a wall ends. It is drawn in a third pass, ON TOP of the texture — drawing it first would let the photograph eat it.*
- **Bake once into an offscreen canvas at boot**, never per frame. Re-bake only on a size change, alongside the existing static layers. *Texture and lettering both live in `bakeWalls`. The one exception is the pit backdrop, which cannot be baked because it moves; see below.*
- **Decode asynchronously.** The maze renders on a solid fill until the image is ready; first paint never blocks on it, and a failed load is a non-event. *`new Image()` + `.decode()` in `ChompCanvas`, one re-bake on success, a silent `.catch()` on failure. The engine never loads its own assets — `render.ts` is handed a decoded image and `test/chomp-audio.test.ts` asserts no module under `engine/` imports `asset()`.*
- **Legibility beats theming.** If it cannot be made readable with four pests on screen, desaturate it to near-texture or drop it outright.
- **The wall mask is ONE drawing operation, and this is not a style note.** *Added 2026-08-04, Phase 5.5, after shipping it wrong.* `destination-in` composites the source against the **whole canvas**, not against the rectangle being drawn — everywhere the source is absent, the destination is cleared. So a loop of ~380 `fillRect` calls does not build up a 380-tile mask: each call erases what the previous ones preserved, and what survives is the last tile drawn. The mask is therefore a single path — one `rect()` per wall tile, then one `fill()`. For the same reason the mask's fill style is set OPAQUE rather than inherited: `destination-in` reads the source's *alpha*, so masking with a leftover 52%-alpha veil colour does not mask, it scales the whole layer to 52% opacity.
  - **The failure mode is why this is in the spec rather than a code comment.** The broken version produced a board pixel-identical to the untextured one, on every browser, with no error, no console warning, a 200 on the asset and a correct re-bake on resize. There is nothing to notice. Anything that looks like "mask a disjoint shape with a composite operator" gets checked against this paragraph.
- **A baked layer is asserted on its PIXELS, not on the code that produced it.** `test/chomp-board.test.ts` bakes the wall layer under a deterministic Canvas2D shim (`test/canvas2d-shim.ts`, itself pinned against hand-computed Porter-Duff values) and checks what came out. The assertion that matters is **"many, widely separated wall blocks are textured"** — not "the textured layer differs from the flat one". Measured: the naive version of that test **passes against the bug**, because one tile does survive and the keyline thickness differs regardless. A test that samples one tile, or that only asks whether anything changed, would have shipped this.
- **The pit holds a looping video, and it goes through the CANVAS, not a DOM layer.** *Added 2026-08-04, Phase 5.5.* `public/chomp/rice.mp4`, a silent 10-second loop of a single glowing grain, drawn into the pen interior every frame with `drawImage(videoEl, …)`. Compositing it on the canvas rather than positioning an element behind it is the decision worth keeping: on the canvas it inherits the letterbox, the DPR cap and the z-order the renderer already has, so it stays aligned through every resize for free and the pests waiting in the pen draw over it with no stacking-context work at all. A positioned element would have needed all of that maintained by hand, twice, and would have drifted the first time either piece of maths changed.
  - It is the **one** part of the board that cannot be baked, because it is the one part that changes without the simulation changing. Everything else still is.
  - The source is square and the pit is 6×4 tiles, so the fit is **COVER, cropping vertically** — `PIT_VIDEO_FOCUS`, a named constant rather than a hardcoded 0.5, picks which slice survives. Measured: the crop keeps the middle two-thirds and cuts the top and bottom sixth, which on this footage is empty vignette. The grain itself is untouched.
  - `muted`, `loop`, `playsInline`, `autoplay`, `preload="auto"` — **muted and playsInline are load-bearing**, not tidy: without both, mobile browsers refuse to autoplay at all. A rejected `play()` is caught and the pit shows a still frame until the next user gesture, which is the same gesture that unlocks the AudioContext.
  - Under `prefers-reduced-motion` it is **paused and rewound**, not hidden — `drawImage` on a paused video paints a still, so reduced motion is one branch in the host and none in the draw.
  - **It costs the simulation nothing**, asserted the way the cutscenes are: no module under `engine/` may so much as mention a video (`render.ts` excepted, and even there it may not create one, set a `src`, or call `play()`), and a run is tick-for-tick identical regardless. See *Testability*.
- **Bold lettering is baked into the wall layer.** *Added 2026-08-04, Phase 5.5.* "One Grain of" on the two-row wall at **rows 6–7, cols 10–17**, and "$RICE" on the matching block at **rows 9–10**, stacked directly above the pit. Those are the only two 8×2 wall blocks in the centre column; there is no third below them, because below rows 9–10 come the row-11 corridor, the gate and then the pit.
  - The face is the theme's rounded display variable, read off the document rather than hardcoded — `next/font` generates the family name at build time, so the CSS variable is the only place it is knowable.
  - **The size is measured, not chosen.** Each line is fitted to whichever of its block's width or height binds first, using `actualBoundingBox` metrics, so one rule covers a 13px portrait tile and a 27px desktop one with no breakpoint. The two lines are deliberately **not** the same size: "One Grain of" is width-bound at every scale and "$RICE" is height-bound, because the dollar sign overshoots both the cap line and the baseline. An assumed cap-height constant fits one of them and clips the other.
  - **Clipped to the block, always.** A letter stroke lying in a corridor would read as a wall that is not there.
  - Measured legibility, which is the requirement rather than the intention: at **13px portrait tiles** the long line sets at 16px with an ~11px cap height and "$RICE" at 21px with ~15px; at 27px desktop tiles, 34px and 43px. Contrast of bone `#f4efe2` on the darkened texture is **11.2:1** against a mean patch and **8.1:1** against its brightest 5%, both past WCAG AAA, and a nori halo stroke guarantees the letterform holds an edge over any patch of photograph. Below a 10px fit the lettering is not drawn at all — a smear where a word should be is worse than a plain wall.
  - It cannot be confused with a grain, a bonus item or a path: it is bone, it is inside a wall, and it never touches a corridor.
  - **The bake waits for `document.fonts.ready`.** `measureText` does not wait for anything, so a bake that happens before the webfont arrives quietly measures and draws the FALLBACK face — and because it is baked, it stays wrong for the life of the page, with no error and nothing in the console. One extra bake at boot rules it out. It is not covered by the texture's re-bake, because the high-contrast board never loads a texture.
- **Golden grains are stylized paddies** — flooded field, a few rows of shoots, high contrast — drawn procedurally, not downscaled from a photo: a tile is ~27px and detail below about 24px dies. They carry a slow pulse or shimmer so they separate from ordinary grains by **motion as well as shape**.

## Leaderboard

**Built in Phase 6, 2026-08-05.** *Two references in this file used to say "Phase 7" —
written when the leaderboard was expected one phase later than the board work turned out
to need. The work is the same work; only the number moved. Measurements are in the plan's
§10.*

- Separate `data/chomp.db` via HTTP API routes, with the Next process as sole writer. The grains WS process keeps its single-writer contract untouched. *`src/lib/chomp/db.ts` (`chomp_runs`, `chomp_players`, `chomp_countries`), `GET /api/chomp/leaderboard`, `POST /api/chomp/score`. No new pm2 process, no nginx change, no new port, no new dependency.*
  - **The ONE place this feature touches `grains.db` opens it `readonly: true`** — `src/lib/chomp/grainsName.ts`, for the name prefill below. That is a guarantee rather than a promise: `src/lib/grains/db.ts`'s `getDb()` opens read-WRITE and runs `migrate()` on every open, so importing it "just to read one row" would have made the Next process a writer of a file another process owns by contract, silently and invisibly in a diff. `test/chomp-score.test.ts` asserts that no chomp module imports that module and that the read-only opener is the only other place a database is opened at all.
  - **A second copy of the app on the same box must set `CHOMP_DB_PATH`.** The preview server on :3099 defaults to the same `data/chomp.db` the live process owns, which is two writers — the exact thing this design exists to prevent. Documented in `.env.example`; found by running the preview.
- `better-sqlite3`, WAL, idempotent `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` guards, matching the grains pattern. Set `PRAGMA wal_autocheckpoint` explicitly. *Done, and verified on the created file: `wal 1000 pages, synchronous NORMAL, page_size 4096`.*
- Country attribution reuses the existing nginx GeoIP headers verbatim — no nginx change. *`X-Country-Code` / `X-Country-Name`, read in the route and never from the payload: a player cannot pick a country.*
- Identity: `grain_vid` cookie for dedupe and rate limiting; display name entered per submission, prefilled from the grains board name if present. 3–12 chars, sanitized, profanity-filtered. *Prefill order: the name this device used last (`chomp:name`), then the server's suggestion (this player's previous RICE CHOMP name, else their GRAINS name), then nothing. Dedupe is a UNIQUE index on `(vid, trace_hash)`, so a double-click or a retry after a dropped response is a no-op that reports the truth rather than a second row.*
  - **The name rules are one implementation, imported by both ends** (`src/lib/chomp/score.ts`). The browser checks them so a player learns their name is too short while typing; the server checks them because it is the authority. A client-side copy of a server rule is a rule that drifts.
  - The profanity filter is a substring match over a leet-folded copy, and it has the Scunthorpe problem. That is a decided trade, written down at the list: a false positive costs "pick another name", a false negative puts a slur at the top of a public leaderboard.
- Submission payload: name, score, level reached, duration, grains eaten, pests eaten, bonuses collected, and a compressed input trace. *Duration travels as simulation TICKS and the row stores `ticks × 1000 / 60`. A client-supplied wall-clock duration would be a second forgeable field saying the same thing as the first, and the engine's tick count is the authoritative clock. `bonusesEaten` is the one line this phase added to the engine — `bonus.taken` resets every level, so it cannot answer "how many did this RUN collect". It is written in one place, read by nothing in the simulation, and deleting it would change no tick of any game.*
  - **The trace format is `<delta base36><DIR>` with UPPERCASE direction letters**, and the case split is load-bearing: base-36 already contains `d`, `l`, `r` and `u`, so a lowercase terminator could not be told from a digit and a real trace would mis-split silently rather than fail. A level-1 clear encodes to ~315 bytes.
- Validation, server-side, trusting nothing from the client: rate limit per `grain_vid` and per IP; reject scores above a plausible ceiling for the reported level and duration; reject impossibly short runs; verify score is arithmetically consistent with the reported event counts. Store the input trace unverified so replay validation can be added later as a server-side change only. Document in comments what this does not catch. *All of it, plus a two-sided score bound (a score far BELOW its own event counts is just as much not-a-run as one far above) and the counting rules the maze imposes: grains ≤ 282 per level, golden ≤ 4, pests ≤ 4 per golden grain, bonus items ≤ 2 per level, and enough grains eaten to have reached the level claimed.*
  - **`src/lib/chomp/score.ts`'s header is the honest list, in five numbered items**, and it is the thing to read before adding a check. The short version: a hand-crafted internally-consistent lie passes, the trace is not replayed, a bot playing genuinely at a thousand times real speed is indistinguishable from a player, identities are cheap, and the bounds are loose on purpose because tightening them would start rejecting real runs.
  - **`test/chomp-score.test.ts` asserts that a decoded trace REPLAYS to the same score.** That is the anti-cheat bet made concrete rather than asserted: if it ever stops holding, replay verification is not a later server-side change, it is impossible, and every trace stored in the meantime is worthless.
- Views: global top 100, per-country top 100, personal best in `localStorage`. *"Per-country top 100" is a board of the top 100 COUNTRIES, mirroring the grains game's two boards — top players and top countries — with entirely separate scores. It is not the top 100 players within your own country; both readings fit the sentence and this is the one that matches the game it is mirroring.*
  - **The country board ranks by the country's BEST RUN, not by a sum of its runs.** A sum ranks whoever played most rather than whoever played best, and it is the one number a script can inflate without ever needing a good run. `total_score` is kept as a column because it is free and answers a different question; nothing ranks on it.
  - A GeoIP miss ("XX" / "Unknown") is not a country and is filtered BEFORE ranking, so the numbering has no gaps. Same rule, same predicate as the grains board — `isUnknownCountry` moved from inside `CountryLeaderboard.tsx` to `@/lib/grains/flag` beside the other two country helpers, and the grains board now imports it from there. One definition, three callers, no behaviour change.

### The panel, and the one rule that is not cosmetic

- **Two buttons in the HUD bar**, beside score, lives, level and pests, one per board. Each opens the same panel on its own board; the panel's tabs then switch between them without closing anything.
- **Desktop: a panel to the LEFT of the board, in the gutter column the letterbox already leaves.** Tablet and phone: an overlay over the board. Which form is on screen is decided by CSS — both are rendered and the breakpoint picks one — rather than by a `matchMedia` string that has to stay in step with the Tailwind class on the element it describes. That pair drifts the first time either is touched.
- **ON A PHONE OR TABLET, OPENING THE BOARD MID-RUN PAUSES THE RUN.** The overlay covers the maze completely; an overlay you cannot see through, over a live game with four pests hunting you, is a death sentence dressed as a feature. On a desktop it does not pause, because the panel is beside the board and the maze is fully visible — pausing a game the player can still see and steer would be the surprising thing.
  - The rule asks the LAYOUT which form is live (`offsetParent` is null for a `display:none` element), not a media query. That reads the real answer, from the real CSS, at the real moment, and it is why the docked container is mounted even when the board is closed.
  - Only a pause the panel caused is undone when it closes. A player who had already paused comes back to a paused game, which is what they asked for.
- **The board sizing grid is untouched: still exactly one `1fr` row, still one `1fr` column for the canvas, degenerate-measurement retry intact.** The left gutter grows from 8/11rem to 20/24rem while the board is open, and it costs the maze NOTHING — the gutters are free only while the board is height-bound, which in landscape it always is. Measured at eight viewports: the tile size is identical open, closed and re-closed at every one of them.
- **A control whose caption toggles must not change size.** *Found by measuring, and it is the Phase 6 version of the §9.2 bugs.* "Resume" is 89px against "Pause"'s 84, and with two more buttons in it the HUD row sat within 11px of its wrap point at 1024×1366 — so PAUSING wrapped the row, took 44px out of the play row and resized the maze mid-run, and it did not reliably come back. Fixed twice over: the row gained real margin (`sm:gap-x-6`, 32px across four gaps) and the button gained a width floor. Both were needed; the floor alone leaves the row on the boundary and the margin alone leaves the caption jitter.
- **A leaderboard that will not load must never take the game with it.** Every failure — no session, a 503, an unreachable host, blocked storage — is a message in the panel and a run that carries on untouched.
- **The local board landed early, in Phase 5** (`src/components/chomp/scores.ts`): the top five runs on this device, shown on the attract screen and used by the game-over card to say where a run placed. It is not a preview of the leaderboard and does not become one — the arcade convention is a local board and a world board side by side, and the local one is the only board a first-time player is ever on. A debug run (`?level=N`) is never filed to it, which is a fourth independent thing keeping such a run from counting.
  - **Phase 6 kept it, and the panel shows both.** "This device" comes from `localStorage` and needs no network, so that strip still says something true when the board itself is down; "on the board" comes from the server and says "not yet" until the player has submitted, which is the most useful thing it can tell the player most likely to be reading it.

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
- Zero third-party network requests, verified in the network tab. Self-hosted images under `public/chomp/` are within budget (500 KB total, 300 KB per file). Sound is within the same rule and is `public/sfx/chomp-*.wav`, 184 KB, synthesized in-repo.
  - **Passing as of 2026-08-04, Phase 5, and it was not before.** `layout.tsx` mounts `TranslateProvider` on every page, which loaded `https://translate.google.com/translate_a/element.js` — the only external host in `/chomp`'s HTML, present in the Phase 4 build too, and never asked for by anything in the game. It is now scoped off play surfaces through `src/lib/playSurfaces.ts`, the same list the chopstick cursor and the other decorations use. Measured on the built page:

    ```
    /chomp   hosts: (none — only its own canonical URL)
    /home    hosts: … translate.google.com …
    /play    hosts: … translate.google.com …
    ```

    Translation is untouched everywhere else on the site. **A play surface is therefore NOT TRANSLATED, deliberately** — the HUD already carried `translate="no"` to stop the widget mangling live score digits, so the game was never a page translation had much to offer. Nothing should render a `<LanguageSwitcher>` on a play surface; the context there is inert by design.
    - One honest limit: `next/script` does not unload a script already inserted, and `/chomp` is in `homeNavLinks`, so a visitor who loads `/home` and then client-navigates carries the loaded widget with them. The guarantee is precise and is exactly what "verified in the network tab" measures — **a direct load of `/chomp` makes no third-party request.**
    - **A HOSTNAME IN THE HTML IS NOT A REQUEST, AND THE OLD CHECK CONFLATED THEM.** *Amended 2026-08-04, Phase 5.6.* The measurement recorded above was `curl | grep -oE 'https?://[a-z0-9.-]+' | sort -u`, and its answer for `/chomp` was "no host but its own canonical URL". That worked only because the page had no outbound links. The site nav has four — Telegram, X, Instagram and the Jupiter swap — so the grep now returns four third-party hostnames on a page that still issues **zero** third-party requests. Left alone, a check that cries wolf gets ignored, which is worse than not having it.

      The criterion has not changed; the instrument has. What is measured now:
      1. **Statically** — every element that causes a fetch (`script`/`link`/`img`/`video`/`source`/`iframe` `src`/`href`/`srcset`/`poster`), plus every `rel="preload|preconnect|dns-prefetch"`. `<a href>` is excluded, deliberately and by name. Then every JS and CSS chunk the page actually loads is scanned for absolute URLs.
      2. **At runtime** — the page is loaded in headless Chrome over CDP and every `Network.requestWillBeSent` is collected. That is literally the network tab, which is what this criterion always said.

      Both were re-run for Phase 5.6, at seven viewports: **0 external fetching elements, 0 external subresources, and every request the page issues is same-origin.** The `translate.google.com` string is still in a chunk `/chomp` loads and always was — that was never what the fix removed. What the fix removed was the script tag, and the runtime measurement is the one that can tell the difference.
    - **Re-measured for Phase 6**, because the leaderboard is the first thing on this page that makes a network request at all: 49–50 requests per load with both boards opened, **every one same-origin, zero third-party**. The leaderboard is `/api/chomp/leaderboard` on this host and nothing else — which is also why the plan chose HTTP on this vhost over anything that would have needed a new nginx block.
      - It is **one** request per open, and it was two until it was measured. Both forms of the panel are mounted and CSS hides one, but `display:none` is a rendering decision and not a React one — the hidden component still mounted, still ran its effect and still fetched. `fetchBoards()` now shares an in-flight request.
- Zero new npm dependencies.
- Fully playable keyboard-only and touch-only.
- No hardcoded path prefixes anywhere, TS or CSS.
- Pure-logic modules unit tested under the existing DOM-free vitest setup.
- **Level 1 is completable.** Its job is to teach the maze; a player who cannot finish it never sees the game. Asserted in `test/chomp-difficulty.test.ts`, which clears the board on every seed in about a minute with lives still in hand. *Added 2026-08-04.*
  - The bot used there heads for grains and refuses steps a pest reaches first. It is **not** the kiting suite's bot, which maximises safe space and will happily circle an already-eaten corridor forever — measured with that one, level 1 looked unclearable at every pest speed down to 75% of the player's, a finding entirely about the bot. Any future claim that the difficulty curve is wrong has to come from an instrument that is trying to do the thing being measured.
- The grains game and its WS process are untouched and still working.
