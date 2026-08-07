# GRAINSNAKE — design spec

The reference document for every build phase.

> **This file is maintained, not archived.** When a decision supersedes something written
> here, this file is amended in the same commit that records the decision. It is meant to
> be true on its own — a reader should never need a chat log to know what is current.
> Amendments carry a date and, where the reasoning is not obvious, a line saying why, so
> nobody "fixes" a deliberate choice back to the original wording.

*Started 2026-08-06. RICE CHOMP is the reference implementation for a full game on this
site, and this document deliberately mirrors `docs/rice-chomp-spec.md` section for
section. Where a rule is carried over unchanged it says so and does not re-argue it;
where this game needs a different answer, the difference is stated as a difference.*

## What this is

Classic snake, $RICE-flavoured: a grain of rice grows into a line of grains as it eats,
on an open paddy square, and dies on the paddy wall or on itself. One life, one run, one
score.

**Originality constraint.** Snake is a genre, not a property — the mechanic predates
every branded version of it and there is nothing here to homage or avoid. What still
applies is the site's own rule: no borrowed art, no borrowed audio, no borrowed palette.
Every pixel is drawn procedurally or comes from `public/grainsnake/`, and every sound is
synthesized in-repo.

**What this is NOT.** It is not chomp with a different sprite. Chomp's skill is the
corner — reading four hunters and cutting a junction early. Grainsnake's skill is
*space*: the board gets smaller every time you succeed at it, and the only opponent is
the consequence of your own past route. That difference is why several of chomp's
answers are wrong here, and each of those is called out below rather than left as an
inconsistency for someone to tidy.

## Hard constraints

Carried over from `docs/rice-chomp-spec.md`, unchanged and not re-argued:

- **A guard that can take down production is worse than the hazard it prevents.** Prefer
  a declaration to an inference, a loud message to a hard stop, and never put a hard
  stop on the path out of an incident. This is why the database's single-writer contract
  below is a declared flag and why the deploy preflight warns rather than refuses.
- **A reading taken from somewhere other than the thing under test measures the
  instrument.** Before believing any measurement, ask what result the broken version
  would produce. If it is the same one, the check is decoration. Keep a control in the
  same run.
- Plain HTML5 Canvas 2D + TypeScript. No game engine.
- **Zero new npm dependencies** without asking first.
- **Zero third-party runtime requests.** No CDN, no Google Fonts, no remote scripts, no
  remote images, no analytics. Sound is generated at build time by `scripts/gen-sfx.mjs`
  and played through `src/lib/sound.ts`.
  - **Every new site-wide provider must be checked against `src/lib/playSurfaces.ts`.**
    Anything mounted in `app/layout.tsx` is mounted on this game too, the cost is
    invisible in `layout.tsx` itself, and nobody finds it by reading that file — it is
    found by building the page and measuring it.
- **Self-hosted static images are permitted** under `public/grainsnake/`, referenced
  through `asset()` so they carry the basePath and the cache-busting build stamp.
  Everything else is drawn procedurally.
  - **Size budget: 500 KB total for `public/grainsnake/`, and 300 KB for any single
    file.** Prefer WebP. Decode asynchronously and render a solid fallback until the
    image is ready — first paint never waits on an image. Video is permitted under the
    same rule; check the **pixel format**, not just the codec and the byte count.
  - The budget applies to what is SERVED, and `public/` is served wholesale. An
    oversized original left beside its optimised version is still shipped to every
    visitor; removing it is part of the conversion, not tidying afterwards.
  - **The opening position is that this game ships with NO images at all.** A square of
    paddy, a line of grains and a wall are three procedural shapes, and chomp's 316 KB
    went almost entirely on one wall texture for a maze with 200 wall tiles. If an
    image earns its place later it is subject to the budget above; it does not get to
    arrive because the budget exists.
- Follow the repo convention: thin `page.tsx` → `"use client"` screen component →
  **directive-free engine module** with no React, canvas-DOM or `window` references in
  its pure logic.
- **Fixed-timestep** simulation at 60 Hz, accumulator-driven, decoupled from
  `requestAnimationFrame`. Identical gameplay at any refresh rate. Load-bearing for the
  leaderboard — do not let non-determinism in.
- Letterboxed to the board's aspect and scaled by `devicePixelRatio` (capped).
- Anything static is painted once into an offscreen canvas and blitted per frame.
- Colors and fonts come from the existing `@theme` block in `globals.css`. No new
  palette.
- **THE HAT'S GOLD AGAINST THE PADDY IS LOAD-BEARING, AND IT IS A PALETTE CONSTRAINT
  RATHER THAN A DRAWING PREFERENCE.** *Added 2026-08-06, out of the size gate.*

  At 15px the head and the body are **near-identical silhouettes** — both are a rounded
  grain of roughly a cell across, and at that size the shape difference between them is
  a few pixels of rim. The gate made this plain: what tells a player which end of the
  trail is the head is **the khaki cone against the dark nori field**, not the outline of
  the grain underneath it. The head is found by its colour.

  **THE FUSED TRAIL STRENGTHENED THIS, AND THE CONSTRAINT IS UNCHANGED — ITS REASON
  GOT BIGGER.** *Amended 2026-08-07, after the fuse gate passed.* When this was
  written the head and its neighbour were separate shapes with a gap between them, so
  a player had a weak second cue: the head was the grain at the end of a line of
  discrete grains. *Rendering the trail* removed that gap deliberately — segments now
  overlap along the travel axis until their rims merge, and the head overlaps its
  neck by design (its long axis was raised from 0.5, where it merely touched, for
  exactly this reason).

  So the silhouette cue is now **weaker than it was when this rule was written**, and
  the hat's khaki against the nori is carrying more of the load than it was. Nothing
  about the constraint changes — it was already "do not weaken the hat's contrast" —
  but the cost of breaking it has gone up, and the two rules are now coupled: a change
  to *Rendering the trail* that increases overlap further, or that brings the head's
  fill closer to the body's, spends this constraint's remaining headroom without ever
  touching the palette. Read them together.

  The consequence is the constraint, and it is the reason this sits with the palette
  rules and not in *Rendering the trail*:

  - **Any change to hat contrast is a change to head legibility, directly and at full
    strength.** Darkening the cone, lightening the paddy, moving the hat off khaki, or
    "unifying" the head with the body's palette are all the same edit: they make the
    player's only reliable cue for locating their own head weaker. There is no
    silhouette underneath to fall back on at 15px.
  - So a hat-colour change may not be made on aesthetic grounds alone. It is a
    legibility change, and it needs the same instrument the board size got — the real
    palette, the real background, true CSS pixels, on a phone.
  - The corollary binds the background too: **the paddy may not drift lighter.** The
    contrast is a relationship, and raising the floor costs exactly what lowering the
    hat would.
  - This also fixes the direction of the *hat problem* branch in *The board*. A hat that
    fails to read is a hat-contrast problem to be solved in the palette; it is not a
    reason to enlarge the cell, and it is not solved by drawing a more detailed hat —
    there is no room at 15px for detail, only for contrast. (The live renderer already
    concedes this: `drawHat()` skips its straw seam below 20px cells rather than smear
    it into a grey haze, so *both* of this game's candidate sizes were always going to
    be reading a flat cone. Contrast is all there is.)

### The one hard constraint this game adds

- **THE SIMULATION IS CELL-GRAINED. THE RENDER IS NOT.** Chomp moves in `SUB`-subunit
  integers because a maze-chase needs sub-tile positions — cornering early is the whole
  skill, and "early" is measured in subunits. A snake has no such need: it occupies whole
  cells, it turns only on a cell boundary, and a sub-cell position would be a quantity
  the rules never read.

  So the simulation stores cells, advances one cell per `stepTicks`, and stores nothing
  finer. The **render** interpolates between the previous and current cell for smooth
  motion, using the fractional part of the tick accumulator — which is a float, in the
  render layer, where floats have always been allowed and are never replayed.

  This is not a simplification of chomp's model, it is a different one, and the reason
  matters: a sub-cell snake would have a *representable* state that the rules cannot
  distinguish, and every such state is somewhere a replay can diverge for free. It is
  also what makes the server-side replayer in *Anti-cheat* viable at all — an
  integer-only state is one a Node process can reproduce exactly, and a float one is not.

  **The three render-layer rules that follow from it.** *Added 2026-08-06, Lito's
  review, before any code was written.* Cell-grained state is cheap in the engine and
  buys three specific ways to look broken in the renderer. Each is a rule, not a
  reminder:

  1. **The head renders LAGGING, never leading.** At accumulator fraction `f`, the head
     is drawn between `prevCell` and `currentCell` — the cell it came from and the cell
     the simulation has already put it in. It is never drawn between `currentCell` and a
     predicted next cell. Leading requires extrapolating along the direction vector,
     which draws the head *inside the wall* on the step before the collision resolves,
     so the player watches the death happen a frame after it visibly already had. The
     cost of lagging is exactly one step of visual latency — 67 ms at tier 7, 167 ms at
     tier 1 — and that is the correct trade.
  2. **Each segment interpolates toward its SUCCESSOR CELL, not along the current
     direction.** Segment `i` is drawn between `cell[i]` and `cell[i-1]` — where the
     segment ahead of it actually is. Interpolating every segment along the head's
     direction vector is the cheap version and it makes the whole body cut the corner
     on the tick a buffered turn lands: the turn is in the state, the body is drawn as
     if it were not, and for one step the snake is a diagonal. The body has to follow
     the route the body actually took.
  3. **The accumulator fraction is FROZEN on pause and on game over.** Two separate
     freezes, and both are needed. Wall-clock must stop accumulating while paused, or
     resuming fires a burst of steps for the time spent in the menu; and the *fraction*
     must be held at its last value, or the trail keeps sliding smoothly between cells
     after the simulation has stopped — a paused snake visibly still moving, and a dead
     one still gliding into the wall that killed it.

## Route and information architecture

**GRAINSNAKE lives at `/games/grainsnake`.** New route, no predecessor, so nothing
redirects to it and nothing needs to. The canonical scheme is `/games/<slug>` with no
exceptions: `chomp`, `grains`, `catch`, `grainsnake`.

**IT IS A PLAY SURFACE.** It goes in `PLAY_SURFACE_ROUTES` in
`src/lib/playSurfaces.ts` in the same commit that adds the route, and
`test/play-surfaces.test.ts` gains a fourth longhand row.

The test for that list is *"does an ambient decoration fight this page?"*, never *"is it
in `src/config/games.ts`"* — two of the three existing games are deliberately NOT on the
list. This game is, for three reasons, in descending order of how much they matter:

1. **The Konami listener eats the arrow keys**, which are this game's primary control.
2. **The translate script would be a third-party request** on a route that claims zero
   of them in *Acceptance criteria*, and it is the only thing that would make that claim
   false.
3. A chopstick cursor and a drifting rice-particle field over a board where the player is
   reading occupied cells is noise on the one channel the game communicates through.

**Adding the route without adding the list entry fails SILENTLY** — nothing throws, the
page renders, and both of the above quietly come back. That is what the test is for.

**`src/config/games.ts` gets one entry, and that is the whole registration.** Four
surfaces render from it — the `/games` index, the home page's Games section, the 🎮 Games
dropdown, and `/games` route metadata — none of which contains a game's title, tagline
or blurb as a literal. **The count word is computed**, so this game turns "Three games,
no install" into "Four games, no install" everywhere at once, by existing.
`test/one-games-list.test.ts` asserts the absence of the literals.

### Path handling

`basePath` is `""` in production — the site owns its own domain. **Never hardcode a path
prefix, in TS or in CSS.** Use `asset()`, `BASE_PATH`, or root-relative paths.
`usePathname()` and `<Link>` are both basePath-aware, so the route strings in
`games.ts` and `playSurfaces.ts` carry no prefix.

### Testability

`vitest` here is node-env and DOM-free by design. Board state, the step function, food
spawning, the turn queue, the speed curve and scoring must be pure functions, importable
without a DOM, and unit tested. The render layer can stay untested.
`noUncheckedIndexedAccess` is off, so bounds-guard every cell lookup by hand.

Planned suites: `test/grainsnake-{board,step,spawn,turns,speed,score,replay,db}.test.ts`,
plus the shared `test/canvas2d-shim.ts`, and the existing `test/play-surfaces.test.ts`
gains this route.

**`replay` is the suite this game has that chomp does not**, and it is listed here
rather than in a later phase on purpose — see *Anti-cheat*.

## The board

- **23 × 23 cells**, square, walled on all four sides. Odd on both axes so there is a
  true centre cell to start on and a true centre column to start pointing along.
- The wall is a *border*, not a tile type inside the field: there are no interior
  obstacles. The board is empty and the snake is the only thing on it that can kill the
  snake. That is the genre and it is also the design — see *What this is NOT*.
- **529 cells, of which one is the head at t=0.** The maximum attainable length is
  therefore 529 and the game has a real, reachable end state. Filling the board is a win
  and is worth saying so on screen — it is the highest score in the game **by
  construction**, since score is monotonic in length, which is exactly why it needs no
  bonus attached to it. See *Scoring*.
- Aspect is 1:1, so the letterbox is square. On a phone in portrait that leaves room
  above for the HUD and below for the swipe hint and the optional d-pad, which is the
  layout the touch controls were designed around on chomp and works better here.

### 23 IS SETTLED. THE GATE PASSED.

*Decided 2026-08-06. The number was provisional for one day and is not provisional any
more; the prototype that settled it is described here because the finding is what makes
the number defensible, and a board size with no recorded reason is one somebody
re-litigates.*

**What was asked.** 23 cells across a 350px usable width — a 390px phone minus the page
gutter, the narrowest real case — is **~15px per cell**, and the risk was never the
geometry. It was that a chain of grains at 15px stops reading as *grains* and starts
reading as one smooth textured tube, which is the single outcome the art direction of
this game exists to prevent: the snake is a line of individual grains of rice, and a tube
with a hat on it is a different game wearing this one's name.

**What the gate showed.** A throwaway page rendered four cases — a single hatted head and
a 13-segment chain, each at 15px and at 18px — drawn on the real nori paddy with the
real palette and the real hat geometry, and looked at on a phone:

> **At 15px, 13 adjacent grains read as 13 grains — through a straight run AND around a
> corner.**

The corner is the part that counts. It was drawn as an actual turn in the chain rather
than two straight runs meeting, so the outside of the turn spread the segments and the
inside crowded them, and the grains stayed individually legible in both. That is the
condition the whole question reduced to, and it held at the smaller size.

**Why the measurement is trustworthy**, in the terms this project already uses for any
reading — *a reading taken from somewhere other than the thing under test measures the
instrument*:

- **True CSS pixels**, verified rather than assumed. Each case measured its own
  `getBoundingClientRect()` against the width it asked for and would have reported
  **"SCALED — READING VOID"** on a mismatch. All probes passed, so 15px on that screen
  was 15px.
- **On a DPR-3 phone**, with the backing store scaled by `devicePixelRatio` and the CSS
  size never transformed. A DPR-1 desktop reading would have been the instrument, not
  the board — at DPR 3 a 15px cell has 45 device pixels of detail to work with, which is
  the real rendering condition and is harsher to judge, not kinder.
- **On the real background.** Drawn on the nori paddy, not on white. Contrast is half of
  whether a grain reads and a white-background gate would have measured a page that does
  not exist.
- **With the real primitives** — the ported `drawHat()` including its sub-20px straw-seam
  skip, rounded-ellipse grains with a dark rim and a lighter spine, per-segment jitter.
  Placeholder rectangles would have answered a question about rectangles.

**19×19 IS NOT THE FALLBACK ANY MORE. IT IS A REJECTED ALTERNATIVE.** It was the standing
answer to "body does not read", and the body read, so the condition that would have
selected it never occurred. Recorded as rejected, with the cost it would have carried:

- It buys **168 fewer cells** (361 against 529) and roughly a third off the maximum
  length — the entire late game, which is where 90% of a full run's score lives (see
  *Scoring*), traded for ~3px of cell that the measurement says was not needed.
- It preserves everything 23 was chosen for — odd on both axes, true centre cell, true
  centre column — so it was never wrong, merely unnecessary. **That is the reason to
  write it down rather than delete it:** it is the obvious move for anyone who later
  finds the board cramped, and the answer is that the smaller board was considered,
  costed, and rejected on a measurement rather than overlooked.
- Re-opening it needs a new measurement, not a new opinion. Everything downstream is
  parameterised on `COLS`/`ROWS`, but the *Scoring* arithmetic and the tier thresholds
  are tuned to 529 cells, so changing it now is a re-tune rather than a constant — which
  is precisely why the gate ran before the renderer existed.

**What the gate did NOT settle, and what it opened.** Legibility of individual grains is
not the same property as legibility of the *trail*, and the same render exposed a
separate problem: the segments were drawn with visible gaps between them at both sizes.
That is a renderer requirement, not a board-size one, and it is in *Rendering the
trail* below.

## Rendering the trail

*Added 2026-08-06, out of the size gate. A **Phase 3 renderer requirement**, listed with
the rules rather than left as a drawing note, because it changes what the player can
read off the board.*

**SEGMENTS MUST OVERLAP ALONG THE TRAVEL AXIS UNTIL THEIR RIMS MERGE.** The trail is
fused grains, not a line of separated beads.

The gate drew one grain per cell, centred, sized to sit inside it — and at **both** cell
sizes the result was a row of individually legible grains **with visible gaps between
them**. Individually legible was the property being tested and it passed; a continuous
body was not being tested and it failed. So this is not a defect the gate found in the
board size, it is a requirement the gate found for the renderer, and the fix belongs in
the phase that first draws a snake rather than in a polish pass.

**The two costs of not fixing it, and the first one is a gameplay cost:**

1. **The trail stops reading as a continuous wall at speed.** A beaded trail has gaps,
   and gaps invite a read that the rules do not support — *could I have slipped through
   that?* The answer is always no: the body occupies whole cells and there is no gap in
   the collision model at all. But the player is steering off the picture, not off the
   model, and a death into a space that looked passable is an **unfair-feeling death**.
   At tier 7 there is no time to reason about it, only to read it. This is the whole
   argument: the trail is the primary thing the player navigates against, and a picture
   that under-reports it is a picture that lies at exactly the moment it matters.
2. **The premise is grains JOINING.** A grain of rice that eats becomes two grains of
   rice stuck together, then three — that is the entire visual idea of the game and the
   reason the snake is made of grains at all. Separated beads describe a queue of
   unrelated grains that happen to be travelling in formation, which is a different and
   much less interesting picture. The chain has to look *joined*, because joining is what
   the game is about.

**KEEP THE PER-SEGMENT JITTER.** The obvious fix — grow the segments until they touch —
solves both costs and creates the failure the gate was built to catch: a perfectly
uniform overlapping chain is an **extrusion**, a smooth tube with a hat on it, which is
the exact outcome the art direction exists to prevent. So the overlap and the jitter are
one requirement, not two:

- **Overlap along the travel axis only.** The long axis grows past the cell boundary so
  consecutive rims merge; the short axis does not, or the trail thickens into a rope.
- **Retain the deterministic per-segment jitter** on long-axis length and rotation, so a
  fused trail is still visibly *made of* individual grains at slightly different angles
  and lengths. Merged rims plus varied silhouettes is the target; merged rims plus
  identical silhouettes is the tube.
- **The corner is the acceptance test**, for the same reason it was in the gate: the
  outside of a turn spreads segments apart and the inside crowds them, so it is
  simultaneously where a gap is most likely to open and where an over-generous overlap
  most likely smears into a blob. If it reads at the corner it reads everywhere.
- Jitter stays **deterministic and derived from the segment index**, never random per
  frame — a trail that shimmers as it is redrawn is worse than either failure mode, and
  the render layer must not acquire state the simulation does not have.

## The snake

- Starts at the centre cell, **length 3**, pointing RIGHT, and **does not move until the
  first input.** A run that begins moving before the player has touched anything spends
  its first second punishing a player who is still reading the screen. The tick counter
  starts on the first input, which also makes tick 0 of the trace meaningful.
- Eats a grain by entering its cell. Length grows by 1. **The tail does not advance on
  the step that eats**, which is the standard construction and the only one where the
  drawn length and the stored length agree on every frame.
- **Dies on the border wall, and on any cell its own body occupies** — with one exact
  exception, stated because it is the classic off-by-one in this genre: **the tail cell
  the tail is about to vacate is not a collision.** A snake moving into the square its
  own tail leaves on the same step survives. Getting this wrong makes tight turns
  randomly fatal at exactly the lengths where a player is proudest of them.
- **ONE LIFE. NO CONTINUES.** Chomp has three and this has one, deliberately:
  - A life that restarts you at length 3 is not a second chance, it is a second game.
  - A life that preserves your length is not a penalty, because length *is* the
    difficulty — you would be handing back the only thing that was making it hard.
  - **There IS a third door, and it is worth writing down because it is the interesting
    one.** *Added 2026-08-06, Lito's review; the first draft claimed there were only
    two.* **Death truncates the trail but preserves the score.** The player carries on
    from length 3 with everything they earned, which is a genuine second chance at a
    genuine cost.

    It would incidentally fix the ordering problem in *Scoring* — score would stop being
    monotonic in length, because a player could bank 20,000 across three short lives and
    a single long life could not be inferred from the number. That is a real property and
    it is the strongest argument for it.

    **Rejected for v1 anyway**, on two counts. It breaks "length is the difficulty",
    which is the load-bearing idea the rest of this file rests on — a player who dies at
    length 90 and resumes at 3 has bought their way out of the only thing making the game
    hard. And it makes the leaderboard's `length` column lie: `best_length` would be the
    longest trail within a run rather than a description of the run, and two rows showing
    90 would mean different things. Reconsider it as an explicitly separate mode, never as
    a change to this one.
  - So: one life. The run is the unit, which is also exactly what the leaderboard stores,
    and it is what the '90s brief this game is a homage to actually did.

## Food

- **One ordinary grain on the board at all times.** Eaten, respawned immediately.
- **Spawn is uniform over the FREE cells, chosen with the seeded PRNG** — never
  rejection-sampled over all cells. Rejection sampling is the obvious implementation and
  it is wrong twice: it consumes a variable number of PRNG draws (so the stream desyncs
  under replay the moment anything changes), and its expected running time goes to
  infinity as the snake fills the board, which is a hang at precisely the moment a
  player has earned the right not to be hung. Build the free-cell list, draw one index.
- **The golden grain is the only decision in the game.** It appears on a **grain
  counter, not a timer** — every 8th ordinary grain eaten — and it expires on a **travel
  budget of 40 STEPS**, counted down one per step, whether or not it is taken.
  - Appearing on a counter rather than a clock makes it a reward for playing rather than
    for surviving, which is the same argument chomp's bonus items settled and the same
    conclusion.
  - Expiry is what makes it a *decision*: it is somewhere else on the board, the detour
    costs space, and the space costs more the longer you are. A permanent golden grain
    is just a grain worth more.
  - It grows the snake by 1, the same as any grain. The reward is score, not size —
    size is a cost the player is already paying.
  - **THE BUDGET IS IN STEPS, NOT SECONDS, AND THAT IS BOTH A CORRECTNESS AND A DESIGN
    FIX.** *Corrected 2026-08-06, Lito's review; the first draft said "6 seconds".*
    - **Correctness.** A wall-clock expiry cannot be reproduced by a server-side
      replayer, which has no client clock — it would break the replay verification in
      *Anti-cheat* outright. Anything the rules read must be counted in the units the
      simulation advances in. This is the same unit error as the speed curve, inverted:
      there, seconds were unrepresentable; here, they are unreproducible.
    - **Design.** 6 seconds is 36 cells of travel at tier 1 and 90 at tier 7, against a
      maximum Manhattan distance of 44 on this board. So a wall-clock budget makes the
      reachability question genuinely tight early and then dissolves it completely
      exactly when the game is hardest — the decision evaporates at the only point it
      would have been interesting. A fixed **40-cell** budget sits just under the
      44-cell diagonal at every tier, so "can I get there and back into space?" stays a
      real geometry question for the whole run, and the escalating difficulty comes from
      routing around your own trail rather than from the clock.

## Speed

**The speed curve is authored in integer TICKS PER STEP, not in cells per second.** This
is the load-bearing constraint of the whole file and it reads like a formatting
preference, so: only an integer number of ticks can elapse between two steps in a
fixed-timestep simulation, so any cells-per-second figure that is not `60 / n` for
integer `n` is a number the engine cannot actually produce. Authoring in tiles/second
and converting — which is what chomp does, correctly, for its subunit speeds — would
here mean writing down eight speeds and shipping six of them.

**AND THE TICK IS DERIVED FROM ACCUMULATED TIME, NEVER FROM COUNTING `rAF` FRAMES.**
*Stated explicitly because "60/n" is exactly the phrasing that hides this.* The host adds
elapsed wall-clock to an accumulator and drains whole 1/60 s ticks out of it; it does not
advance one tick per animation frame. A frame-counted loop of this shape runs the game at
**double speed on a 120 Hz phone** and at 0.75× on a 45 Hz power-saving panel, and it is
the single most common way this class of loop ships broken — it is invisible on the
machine it was written on, and it is not a rendering bug, it is a different game. The
accumulator is also clamped, so a backgrounded tab returning with 40 s of debt does not
spend it in one frame.

| Tier | Food eaten | Ticks/step | ≈ cells/sec | Ratio | Score multiplier |
|------|------------|------------|-------------|-------|------------------|
| 1 | 0–7 | 10 | 6.0 | — | ×1 |
| 2 | 8–16 | 9 | 6.7 | 1.11 | ×2 |
| 3 | 17–26 | 8 | 7.5 | 1.13 | ×3 |
| 4 | 27–37 | 7 | 8.6 | 1.14 | ×4 |
| 5 | 38–50 | 6 | 10.0 | 1.17 | ×5 |
| 6 | **51–80** | 5 | 12.0 | 1.20 | ×6 |
| 7 | 81+ | 4 | 15.0 | **1.25** | ×7 |

- Tier 7 is the floor: **3 ticks/step (20 cells/sec) is not reachable and that is a
  decision.** At 3 ticks a turn entered on the wrong side of a 50 ms window is
  unrecoverable, which stops being difficulty and starts being input lag.
- **THE TIERS ARE NOT THE LEVER. THE THRESHOLDS ARE.** *Added 2026-08-06.* The
  ticks/step column is fixed by the integer constraint above — 10 down to 4 is every
  value there is in this range, so there is nothing to tune in it. The ratios it produces
  (1.11 → 1.25) are a clean geometric acceleration and need no help. **Everything that
  can actually be tuned about the difficulty curve is the food-count column**, and any
  future "the curve is wrong" conversation is a conversation about those seven numbers.
- **Tier 6 is deliberately more than twice as long as tier 5 (30 items against 13) —
  because it is where competent players actually live.** *Reason replaced 2026-08-06,
  Lito's review; the widening is unchanged and the superseded reason is recorded below
  rather than deleted, the same way the score-shape correction is handled in* Scoring.

  Tier 7 begins at item 81, which is length 84. **Most runs end well before that** — a
  player dying at length 45 experiences tiers 1 through 5 and never reaches the top of
  the curve at all. Tier 6 is the last tier a competent-but-not-exceptional player
  actually spends time in, and tuning attention belongs where players are.

  **THE THRESHOLDS ARE TUNED AGAINST THE DEATH-LENGTH DISTRIBUTION, NOT THE FULL-BOARD
  CASE.** This is the general rule and it is the one worth carrying: the arithmetic in
  *Scoring* — 445 of 526 items eaten in tier 7, 90% of the score — is a true description
  of a run **almost nobody has**. It is the right instrument for sizing the replay caps
  and for deciding that a full-board bonus was decoration, and it is the wrong instrument
  for deciding how long a tier should last. A curve tuned to the perfect game is a curve
  tuned for the one player who does not need it.

  So the number that should drive the next revision of this column is *where runs
  actually end*, which is a measurement this project does not have yet and which the
  difficulty bot in `test/grainsnake-replay.test.ts` is not the instrument for — it plays
  to fill the board, which is the distribution being argued against here.

  - *Superseded reason, recorded:* the widening was first justified as headroom before
    the 5→4 jump — the largest ratio in the table at 1.25, landing when the trail is
    longest and free space smallest. That is still **true**, and it is still a fine
    secondary argument; it was replaced because it reasons from the shape of the table
    rather than from where players are, and on its own it would have justified widening
    tier 6 by a little when the case for widening it is a lot.
- Otherwise the boundaries widen as they climb so that each tier lasts roughly the same
  *wall-clock* time (~20 s) rather than the same number of grains: a tier that is twice
  as fast and the same length in grains is half as long to live in.

## Scoring

- **Ordinary grain: 10 × tier. Golden grain: 50 × tier.** Tier is keyed on total food
  eaten, which is exactly `length − 3`.

- **THE MULTIPLIER IS A FEEL DECISION AND NOTHING ELSE. IT DOES NOT SEPARATE PLAYERS.**
  *Corrected 2026-08-06, Lito's review. The first draft of this section claimed the
  multiplier meant "two players at length 40 have played differently"; that claim was
  false and is recorded here rather than quietly deleted, because it is the kind of thing
  that gets re-invented.*

  Tier is a function of food eaten, and food eaten is a function of length. So `10 × tier`
  is a strictly increasing function of length, which is **order-isomorphic to length**:
  two players at length 40 do not have different scores, they have *identical* scores.
  The multiplier changes the score's shape — superlinear instead of linear — and leaves
  its ranking exactly where it was. A leaderboard sorted by it is still a length
  leaderboard.

  Keep it anyway, for the reason that survives: **a grain eaten at 15 cells/sec should
  weigh more than one eaten at 6**, and a run that is 90% tier 7 (see the arithmetic
  below) should have a score that says so. That is a legitimate argument about feel. It
  is not an argument about ranking, and it must never be written up as one again.

- **GOLDEN GRAINS ARE THE ONLY THING THAT SEPARATES TWO PLAYERS AT EQUAL LENGTH, SO THEY
  ARE SHOWN AS THEIR OWN NUMBER.** They are optional, they expire, and taking one costs a
  detour — so they are the single quantity in this game that a player controls
  independently of how long they survived. That makes them the only real second axis, and
  folding them invisibly into one total wastes them.
  - The HUD shows **score, length, goldens** — three numbers.
  - The leaderboard row carries `best_length` **and** `goldens` beside the score.
  - Score is therefore `base(length) + golden bonus`, where `base` is fully determined by
    length and the golden term is the only free variable. Stating it that way is what
    stops the next person re-deriving the mistake above.

- **THERE IS NO FULL-BOARD BONUS.** The first draft put it at 10,000, "the highest score
  in the game by a wide margin". The arithmetic says otherwise, so here is the
  arithmetic — 23×23, start length 3, 526 food items, goldens at every 8th ordinary grain
  (so 468 ordinary + 58 golden):

  | Tier | Food | Items | Score | ≈ sec |
  |---|---|---|---|---|
  | 1 | 0–7 | 8 | 116 | 20 |
  | 2 | 8–16 | 9 | 260 | 20 |
  | 3 | 17–26 | 10 | 433 | 20 |
  | 4 | 27–37 | 11 | 636 | 19 |
  | 5 | 38–50 | 13 | 939 | 20 |
  | 6 | 51–80 | 30 | 2,600 | 38 |
  | 7 | 81–525 | **445** | **44,994** | 445 |

  **A full board scores ≈ 50,000, and tier 7 is 90% of it** — because 85% of the board is
  eaten there. A 10,000 bonus would be **20%** of a run that had already scored 50,000:
  not a wide margin, a rounding error with a ceremony attached.

  It is also unnecessary. Score is monotonic in length and 529 is the maximum length, so
  **a full board is already the highest score in the game by construction** — a bonus
  cannot make it more first than first. What the board gets instead is a **`filled` flag
  on the row**, rendered as a mark beside the name. A thing nobody has done should be
  recognisable, not merely numerically large.

- The run ends on death or on a full board. There is no other terminator.
- **Every tuning number** — the tier table, the golden-grain counter and lifetime, the
  starting length, the board size, the turn-queue depth — lives in one
  `engine/rules.ts`. No magic numbers in engine code. Durations are authored in ticks,
  because ticks are what the simulation reads.

## Controls

Carried over from chomp, unchanged and for the same reasons:

- Keyboard: arrows and WASD. `P` or `Esc` pauses. `M` drives the **site's** sound switch
  (`grains:sound`), never a private one — a player who muted the site must not still be
  getting chirped at.
- Touch: swipe and an optional on-screen d-pad, both available. **The d-pad defaults OFF
  on every pointer type**; swipe is primary and always live, and the line under the board
  says so. An explicit choice overrides the default forever after, in both directions.
- **The swipe re-anchors after every turn** — a drag registers at 22 CSS pixels of travel
  and then resets its origin, so one unbroken drag can trace a whole route without
  lifting off. A lift with no turn in it is a TAP, which means "get on with it".
- **A control with focus owns `Space` and `Enter`. It never owns the steering keys.** The
  window-level handler cancels the default action of the arrows and WASD whatever has
  focus; it must never cancel `Space`/`Enter`, which are how a keyboard reaches a link at
  all. The guard is `closest("a[href],button,[role='button']")`.
- **Every input route ends at one function.** Arrows, WASD, swipe and d-pad are four ways
  of calling `steer()`, and that is what keeps touch out of the input trace's business.

Two rules this game adds, both of them **inside the simulation** and therefore part of
what replays:

- **A reversal is DISCARDED, not queued.** An input opposite to the direction the snake
  is *currently committed to* is dropped on the floor. It cannot be buffered "for later",
  because by the time later arrives the snake has turned and the reversal is now a legal
  move the player did not ask for — which is the single most infuriating bug in this
  genre and it is always this.
- **The turn queue is TWO DEEP.** At tier 7 a step is 67 ms, and a player planning a
  corner has to be allowed to enter both halves of it before the first one lands. One
  slot is enough at 6 cells/sec and demonstrably not at 15. Three would let a player
  queue a route they can no longer see the consequences of. The queue is engine state,
  it is drained one entry per step, and each entry is validated against the direction at
  the moment it is *drained* rather than the moment it was entered.

## Sound

Five cues, synthesized by `scripts/gen-sfx.mjs` into `public/sfx/snake-*.wav` and played
through `src/lib/sound.ts` — the same pipeline, the same player and the same site-wide
mute as everything else. Seeded generation, so the WAVs are byte-identical on every
regeneration and a rebuild is not a diff.

| Cue | When |
|-----|------|
| `snakeEatA` / `snakeEatB` | An ordinary grain. **Alternates**, a fourth apart, the same trick the chomp uses — a single repeated clip at 6–15 per second is a machine gun. |
| `snakeGolden` | The golden grain, taken. |
| `snakeTier` | Crossing into a new speed tier. The only warning the player gets, and it needs to arrive *with* the change rather than after it. |
| `snakeDeath` | The run ends. |

- **Sound is DERIVED from the simulation, never emitted by it.** The obvious wiring is
  `playEat()` inside the step function, and that is exactly what must not happen: the run
  is replayed server-side by a Node process with no speakers. The host observes state
  transitions and plays clips; the engine makes no noise and knows nothing about audio.
- Golden-grain expiry is deliberately **silent**. A sound for a thing the player chose
  not to do is a scolding.

## UI and presentation

- HUD: score, length, tier. Marked `translate="no"` — the widget is scoped off this route
  anyway, but the attribute is the belt to that braces and costs nothing.
- Text on the same fluid ramp chomp uses, so the page grows on a large monitor instead of
  staying phone-sized.
- The site nav (`JourneyNav`) sits above the board in its play-surface form: in flow
  rather than fixed, solid rather than waiting for a scroll that never comes, and with no
  language control, because the translate context on a play surface is inert by design.
- "← Back to the rice paddy" is a board-edge button on a wide landscape viewport and the
  header link everywhere else — exact complementary breakpoints, so there is exactly one
  of it at every size and never two links saying the same thing.
- Attract screen, pause screen and game-over card, in chomp's shapes.
- **The local top-5 board is not the leaderboard**, and both exist. The arcade convention
  is a local board and a world board side by side, and the local one is the only board a
  first-time player is ever on. `localStorage`, five rows, cached snapshot so
  `useSyncExternalStore` is stable.
- **A high-contrast toggle**, `grainsnake:contrast`, game-local for the same reason
  chomp's is: nothing else on the site has an opinion about it. It changes what is
  painted and nothing else.
- **NONE OF THE ABOVE REACHES THE SIMULATION.** Menus run while the engine is not being
  ticked at all. A run played with the leaderboard panel open is bit-identical to one
  played without it.

## Leaderboard

Its own database, its own API namespace, and **nothing shared with RICE CHOMP except the
identity cookie**.

- **`data/grainsnake.db`.** Not `chomp.db`, not `grains.db`. One file, one writer.
- **Single-writer contract, enforced by a DECLARATION.** `GRAINSNAKE_DB_OWNER=1` in
  `ecosystem.config.js`'s env block for the `onegrainofrice` app — **never in
  `.env.local`**, because the preview server runs from the same working directory and
  reads the same `.env.local`, so a flag placed there is inherited by the very process
  the guard exists to catch. A process that has not declared ownership refuses the
  default path with a message naming its own fix; an explicit `GRAINSNAKE_DB_PATH` is
  always honoured, because naming a file is taking responsibility for it.
- Tables `grainsnake_runs` (append-only audit trail, holds the trace) and
  `grainsnake_players` (denormalised best-per-player, so the board is one indexed read).
  `UNIQUE(vid, trace_hash)` makes dedupe a database property rather than a check someone
  can forget to run. One `handle.transaction()` per multi-table write: two tables that
  disagree about a player's best score are worse than no board at all.
- **One board, top 50, by best single run.** Flag beside the name from the country stored
  on the *write*; no country board.
- **The board row is score, length, goldens, and a `filled` mark** — not score alone.
  `best_length` sits where chomp's board has `best_level`: same shape, different noun.
  `goldens` is there because, per *Scoring*, it is **the only quantity that can separate
  two players of equal length** — the base score cannot, being a function of length, and a
  board that hides its one real second axis is a board sorted by one number pretending to
  be two. The `filled` flag marks a completed board, which needs recognising rather than
  scoring.
- `grainsnake_runs` additionally carries **`engine_version`** on every row. See
  *Anti-cheat* — without it, the first tuning pass silently rescores every stored replay.
- **Identity is the existing signed `grain_vid` cookie**, HttpOnly, minted by
  `/grains/session`, read from the cookie header rather than from a field. **No new
  secrets**: the cookie secret and the IP salt are read through `getGrainsEnv()`. Two
  secrets for one cookie is two things to rotate and one of them will be forgotten.
- Name prefill follows chomp's: this game's name if there is one, else the name they
  chose on the grains board, read from `grains.db` **`readonly: true`** so this feature
  cannot write it even by accident.
- **HTTP, not a WebSocket.** A score is one discrete event per run; a second WS path
  would need an nginx `location` block and therefore sudo; and joining the grains socket
  would put a second full leaderboard on the wire every 250 ms while the player is trying
  to hold 60 fps.
- `no-store` on both routes. Rate-limited per vid and per IP hash, in the same shape and
  with the same honest note that the vid bucket is a speed bump and the IP bucket is the
  real ceiling.

## Anti-cheat

The client is validated the way chomp's is — `checkRun()` re-derives every number
server-side, the name is re-sanitized whatever the browser did to it, the country comes
from nginx rather than the payload, and the duration is DERIVED from `ticks` rather than
accepted. Everything in chomp's *what this does not catch* list applies here verbatim and
will be restated in `src/lib/grainsnake/score.ts` rather than cross-referenced.

**But this game can actually do the replay, and should, in the phase that ships the
board.**

Chomp deferred replay verification for a real reason: its state space is large — four
pests with distinct AI, mode cycles, subunit positions, cornering tolerances — so a
replayer is a second full implementation of a big simulation, and the plan was to store
traces now and verify later. That reasoning does not transfer. Grainsnake's entire state
is *(cells, direction, queue, PRNG, counters)*, the step function is a few dozen lines,
and **the replayer is the step function** — the same module, imported by the route
handler, run without a canvas. There is no second implementation to drift.

So:

- `POST /api/grainsnake/score` re-simulates `(seed, trace)` and **computes the score
  itself**. The submitted score is compared against the computed one and the *computed*
  one is what gets stored.
- A submission whose trace does not produce its claimed score is rejected. Not flagged,
  not stored-and-sorted-later — rejected, with the run still playable.

**THE REPLAY FORMAT IS TICK-INDEXED. IT CONTAINS `(seed, inputs, tick index)` AND
NOTHING ELSE.** *Added 2026-08-06, Lito's review, at the same weight as the integer-state
constraint in* Hard constraints *— because it is the same constraint, one layer out.*

No timestamps. No wall-clock durations. No `elapsedMs`, no `startedAt`, no `playedFor`.
Not "discouraged" — **absent from the format**, so there is no field for one to arrive in.

The reason is the accumulator clamp in *Speed*. A backgrounded tab returns holding
seconds of debt, the clamp drops it on the floor so the run does not spend it in one
frame, and **the replayer never sees that it happened** — it advances tick by tick from
the trace and has no idea the client's wall-clock ran 40 s longer than its tick count
says. So any time-derived field is a client/server divergence *by construction*: the two
sides are not disagreeing about a value, they are computing different quantities. It
would not be a bug to be tracked down; it would be the format working as specified and
producing a mismatch on every genuine run that was ever tabbed away from.

**This is the third instance of one error, so it is written here as the general rule
rather than a third fix.** The other two are on the record in this file:

| # | Where | The error |
|---|---|---|
| 1 | *Speed* | Cells/sec authored where only `60/n` is **representable**. |
| 2 | *Food* | Golden expiry in seconds, which a replayer with no clock cannot **reproduce**. |
| 3 | here | A time field in the format, which the clamp makes **unreconstructable**. |

> **THE RULE: anything the replayer cannot reconstruct from `(seed, inputs, tick index)`
> cannot be in the format, cannot be a rule the simulation reads, and cannot be a stored
> field the server trusts.**

The corollary is already implemented elsewhere and is what "right" looks like: the run's
duration is **derived** server-side as `ticks × 1000 / 60` rather than accepted — the
same call chomp's score route makes, for the same reason. A client-supplied duration
would be a second, forgeable, un-cross-checkable field saying the same thing as the
tick count, and here it would additionally be *wrong*.

**THIS IS NOT ANTI-CHEAT, AND THE SECTION IS NAMED WRONG ON PURPOSE SO THAT NOBODY GETS
TO SKIM IT.** *Priced precisely 2026-08-06, Lito's review.* What replay verification buys
is exactly one thing:

> **It eliminates FORGED scores. It does not eliminate BOTS.**

The reason is structural rather than a gap to be closed later: **the client necessarily
holds the seed**, because it has to simulate the run in order to draw it. A client that
can simulate can also search. So a headless player can compute a perfect route offline
and submit a trace that replays flawlessly — and it *should* pass, because it is a real
run of this game. The honest claim is "every score on this board is the score of a real
run", never "of a human". Anything on this page that implies otherwise is wrong.

  - *The one thing that would move the boundary, named and deferred:* a **server-issued
    seed** with the issue time recorded gives a trusted lower bound on wall-clock
    duration, which catches the run played at a thousand times real speed. It does not
    catch a bot playing at human speed, and it puts a request in front of every run. Not
    in v1; recorded here so it is a decision rather than an oversight.

**EVERY ROW STORES `engine_version`, AND AN UNKNOWN VERSION IS REFUSED RATHER THAN
RESCORED.** *Added 2026-08-06, Lito's review — this is the requirement that makes replay
verification survive contact with a tuning pass.*

The failure it prevents is specific and arrives in month three: someone widens a tier
threshold or changes the golden budget from 40 steps to 35, and **every stored trace
silently begins replaying to a different score under the new rules.** Nothing errors. The
board quietly rescores history against rules those runs were never played under.

- `ENGINE_VERSION` is an integer constant living in `engine/rules.ts`, **next to the
  tunables it describes**, because that is the file someone will be editing when they
  need to bump it.
- It is written to every `grainsnake_runs` row at submit time.
- The replayer refuses a trace whose `engine_version` it does not implement. **Refuses —
  it does not rescore, and it does not guess.** Historical rows keep the score they were
  verified with; they are simply no longer re-verifiable, which is the truth.
- **Any change to a number the simulation reads is a version bump.** That includes the
  tier table, the thresholds, the golden budget, the board size, the queue depth and the
  starting length. If it is in `rules.ts`, changing it bumps the constant beside it.

**VERIFICATION HAPPENS ONCE, AT SUBMIT TIME. A BUMP DOES NOT INVALIDATE THE BOARD.**
*Added 2026-08-06, Lito's review. The rule above covers refusing an unknown version on
the way IN and said nothing about the rows already sitting on the board when the constant
moves, which is the half that actually happens.*

- **A stored row is a record of a run that was verified under the engine it was played
  on.** Its score is final at the moment it is accepted. That is what the row *is*.
- **Rows are never re-verified and never rescored.** Not on a bump, not on a migration,
  not by a maintenance script. There is no code path that recomputes a stored score, and
  the absence of one is the design.
- **A bump therefore invalidates nothing.** The board keeps working, the ranks do not
  move, and nobody's score changes because someone retuned a threshold. The failure the
  version guard prevents is silent *rescoring*; the guard must not become a reason to do
  it deliberately.
- Old rows simply stop being *re-verifiable* — the replayer refuses their version rather
  than guessing at rules it no longer implements. That is the honest state and it costs
  nothing, because verification already happened.

**The consequence, stated plainly rather than discovered later: the board can hold rows
from several engine versions at once, and it will.** If a bump changes scoring materially,
then comparing a v1 row against a v3 row is comparing runs played under different rules.
**That is the caller's problem, not the storage layer's.** The storage layer's job is to
record what was verified and to be honest about which engine verified it, and it does
both. A board that tried to normalise across versions would be inventing scores for runs
that were never played.

  - *The escape hatch, deferred rather than omitted:* if that ever bites in practice —
    a bump big enough that mixed rows read as unfair — the fix is a **display-side
    version marker** on the row, or a board filtered to the current version. Both are
    presentation changes over data that is already stored correctly, which is precisely
    why `engine_version` is on the row from day one. Nothing about them requires
    touching a stored score, and if the answer ever seems to, that is the sign the wrong
    question is being asked.

**Bounds, and where their numbers come from.** A trace is an input to a loop that runs on
the web process, so both the tick count and the trace-entry count are capped and checked
*before* simulating. The caps are **measured, not guessed**: the bot that fills the board
in `test/grainsnake-replay.test.ts` is the same instrument that sets them — a real
perfect game plus headroom. The naive estimate for a full board is ~35,000 ticks, but it
ignores late-game routing detours entirely and is wrong by a large factor in the
direction that matters, which is exactly why the number comes from the bot rather than
from that calculation. The body cap will need to be larger than chomp's 64 KB for the
same reason; it is set once the measurement exists.

`test/grainsnake-replay.test.ts` is the suite that keeps this true, and it has to run
against a *known-bad* trace as well as a good one. A replay checker that accepts
everything passes a suite of valid runs perfectly.

## Acceptance criteria

- 60 fps on a mid-range phone; no GC stutter. **The body is a ring buffer, not an array
  that shifts** — a 500-segment `unshift`/`pop` every 67 ms is the one place this game
  can plausibly allocate in the hot loop.
- **Deterministic**: identical inputs produce an identical run regardless of frame rate,
  device or process. This is testable directly here in a way it was not on chomp — run
  the same `(seed, trace)` twice and diff the final state, and run it once in the browser
  and once in Node.
  - **Asserted at a simulated 120 Hz and 45 Hz, not only at 60.** The frame-counting bug
    in *Speed* produces a perfectly deterministic run at every refresh rate — it just
    produces a *different* one at each. A determinism test that only ever feeds the loop
    16.67 ms frames cannot see it, which makes it a test that would pass on the broken
    version. Drive the accumulator with 8.33 ms and 22.2 ms frames and assert the same
    final state.
- **Zero third-party network requests, verified in the network tab** — the runtime
  measurement over CDP, not a grep for hostnames in the HTML. `<a href>` is excluded from
  the static check by name; the nav's four outbound links are not requests.
  - **The control is not optional.** The same probe, in the same run, must still find the
    third-party hosts on `/games/grains`, `/games/catch` and `/`. A probe that reports
    clean everywhere is measuring nothing.
  - Self-hosted assets under `public/grainsnake/` within budget (500 KB total, 300 KB per
    file), and sound under the same rule at `public/sfx/snake-*.wav`.
- Zero new npm dependencies.
- Fully playable keyboard-only and touch-only. **Genuinely playable one-thumbed in
  portrait** — at tier 7, not at tier 1.
- No hardcoded path prefixes anywhere, TS or CSS.
- Pure-logic modules unit tested under the existing DOM-free vitest setup.
- **`/games/grainsnake` is in `PLAY_SURFACE_ROUTES` and `test/play-surfaces.test.ts`
  covers it by name**, in both directions.
- **A full board is winnable.** Not "reachable in principle" — asserted, by a bot in
  `test/grainsnake-replay.test.ts` that fills the board on a fixed seed. A snake game
  whose win state is unreachable because of a tail-collision off-by-one looks completely
  healthy until someone is at length 500 and has no way to report what happened.
- **The replay format has NO time-typed field.** Not a timestamp, not a duration, not an
  elapsed-ms — `(seed, inputs, tick index)` and nothing else. Asserted against the
  submission type rather than left to review: the clamp in *Speed* makes any such field a
  client/server divergence by construction, so this is a structural check, not a style
  one. Duration is derived server-side from `ticks`. See *Anti-cheat*.
- **The replay checker rejects a tampered trace.** Run it against the failure.
- RICE CHOMP, the grains game and the WS process are untouched and still working.
  `chomp.db` is not opened by anything in this feature.
