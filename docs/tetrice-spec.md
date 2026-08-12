# TETRICE — design spec

The reference document for every build phase.

> **This file is maintained, not archived.** When a decision supersedes something written
> here, this file is amended in the same commit that records the decision. It is meant to
> be true on its own — a reader should never need a chat log to know what is current.
> Amendments carry a date and, where the reasoning is not obvious, a line saying why, so
> nobody "fixes" a deliberate choice back to the original wording.

*Started 2026-08-12. GRAINSNAKE is the closest reference implementation — it is the game
on this site that ships a replay verifier — and this document mirrors
`docs/grainsnake-spec.md` section for section. Where a rule is carried over unchanged it
says so and does not re-argue it; where this game needs a different answer, the difference
is stated as a difference. The standing constraints live in `CLAUDE.md` and are listed in
* Carried over from Grain Snake / Chomp *rather than restated as new decisions.*

## What this is

A falling-block puzzle game for the onegrainofrice site, and the site's **fifth** game.
Seven four-cell shapes fall one at a time into a ten-column well; the player slides and
rotates them as they fall; a row filled across all ten columns clears; the fall speed
rises with level. Same premise, same rules, same seven shapes as the classic.

**The visual identity is that every piece is made of grains of rice.** A cell is not a
square with a bevel — it is a grain, drawn procedurally, in the same hand as the trail in
GRAINSNAKE and the pellets in RICE CHOMP. That is the whole of the reskin and it is the
reason this game exists on this site rather than anywhere else.

**Originality constraint.** The falling-block puzzle is a genre; the name and the look are
someone's property. The naming rule is a **standing constraint in `CLAUDE.md`** and is
binding on code, copy, metadata, alt text, filenames and commit messages:

- **The game is TETRICE.** The trademarked name does not appear in this repo. Not in a
  comment, not in a variable, not in a commit message, not in an `alt` attribute.
- **No borrowed logo, wordmark or colour scheme.** The seven-hue scheme of the official
  versions is part of what is owned; this game's colours come from the site's own `@theme`
  block (see *The pieces*).
- **The shapes are named by letter** — I, J, L, S, Z, T, O — which are descriptions of
  their form and are fine. They are **pieces** or **shapes**. They are not the
  trademarked collective term, in code or in copy.
- The reference mock reads "TETRIS RICE EDITION". **The shipped panel reads
  "TETRICE / ONE GRAIN OF RICE".** The mock is a layout reference; its title block is the
  one part of it that must not be reproduced.

**THE MOCK STAYS OUTSIDE THE REPO, AS A MOOD BOARD. IT IS NEVER COMMITTED, CROPPED OR
OTHERWISE.** *Decided 2026-08-12, later the same day. Until now this file leaned on "the
reference mock" for layout without saying where it lives, which is how an untracked file
becomes a dependency nobody can find.*

- **It lives at `/home/deploy/onegrainofrice-asset-sources/`** on the VPS — the directory
  that already holds chomp's over-budget originals (`ricechompbackground.png`, `rice.mp4`)
  for exactly this reason: source art the repo must not carry. It is outside the repo, not
  gitignored inside it, so there is no version of "it got committed by accident".
- **Why not a wordmark-free crop, which was the other candidate.** The crop would put the
  well and the grain treatment under version control, which is the part the render phase
  needs — but:
  1. **The wordmark is the single worst artifact in this project to publish**, and this is a
     public repo. A crop makes not-publishing-it a judgement someone has to repeat
     correctly every time the file is touched, re-cropped, or restored from a backup. The
     external copy makes it a property of where the file is.
  2. **The mock's colours are already overruled.** *The pieces* takes its seven hues from
     `@theme` and `CLAUDE.md` forbids the official scheme, so the one thing a committed
     image would authoritatively supply — pixels — is the thing this spec has decided not
     to follow. It would be a normative-looking file that must not be followed.
  3. **The layout is already written down in prose** (*UI and presentation*) and that prose
     is the authority. Nothing in any build phase blocks on the image, which is what makes
     keeping it external cost nothing.
- So: **every reference to "the mock" in this file means the external mood board**, it is
  advisory, and where it disagrees with this document, this document wins.

**What this is NOT.** It is not GRAINSNAKE with square food. Grainsnake's skill is
*space* — the board shrinks as you succeed. Tetrice's skill is *commitment under
acceleration*: every piece is a decision that cannot be taken back, and the cost of a bad
one is paid four pieces later, at a speed you did not have when you made it. The two games
therefore want different things from the same machinery, and the places where this file
departs from `grainsnake-spec.md` are called out where they occur rather than left as an
inconsistency for someone to tidy.

## Carried over from Grain Snake / Chomp

These are the standing constraints recorded in `CLAUDE.md`. **Every item in this section is
carried over, not newly decided here.** They are listed so that this file is true on its
own, and they are not re-argued — the argument is in `docs/rice-chomp-spec.md`,
`docs/grainsnake-spec.md` and `deploy/README.md`.

| # | Constraint | Carried over from |
|---|---|---|
| 1 | **Never run `pnpm build` directly — only `deploy/build.sh`.** A direct call with a `NEXT_DIST_DIR` outside the repo bakes an absolute path into tracked `tsconfig.json` and leaves a stray `tmp/`. It fails *silently*. Recovery: `git checkout tsconfig.json && rm -rf tmp/`. | `deploy/README.md`, 2026-08-07 |
| 2 | **Promotion is `deploy/promote.sh <build-id>`; rollback is the same command with an earlier id.** Record the rollback target sha in the commit body. | Chomp Phase 7 deploy separation |
| 3 | **The git remote is the SSH host alias `github-onegrainofrice`.** Never rewritten to `github.com`. | 2026-08-05, first push |
| 4 | **Tailwind v4. Colours and fonts come from the existing `@theme` block in `globals.css`. No new palette.** | Chomp *Hard constraints* |
| 5 | **Zero third-party runtime requests on the play surface.** No CDN, no fonts, no analytics, no remote images, no remote scripts. | Chomp *Hard constraints*, and the acceptance criterion in both specs |
| 6 | **Its own database and its own API namespace** — `data/tetrice.db`, `/api/tetrice/*` — sharing nothing with chomp, grains or grainsnake at the data layer, with the single-writer contract enforced by a **declared** `TETRICE_DB_OWNER` flag rather than by an inference. | Grainsnake *Leaderboard*; the guard rule from Chomp *Hard constraints* |
| 7 | **A guard that can take down production is worse than the hazard it prevents.** Prefer a declaration to an inference, a loud message to a hard stop, and never put a hard stop on the path out of an incident. | Chomp, 2026-08-05 |
| 8 | **A reading taken from somewhere other than the thing under test measures the instrument.** Keep a control in the same run. | Chomp / Grainsnake |
| 9 | **Pure text helpers are shared, never duplicated:** `checkName`, `sanitizeChompName`, `containsProfanity` from `src/lib/chomp/score.ts`. They live under `chomp/` for historical reasons and are pure string functions — reusing them is not a data-layer dependency on chomp, and item 6 is untouched by it. | Grainsnake *Leaderboard* |
| 10 | **A new route's ambient-decoration status is decided in `src/lib/playSurfaces.ts`, in the commit that adds the route.** The exports are `PLAY_SURFACE_ROUTES` and `isPlaySurface`; the match is exact and a missing entry fails silently. | Chomp Phase 7 / Grainsnake |
| 11 | Plain HTML5 Canvas 2D + TypeScript, no game engine; **zero new npm dependencies** without asking; thin `page.tsx` → `"use client"` screen → directive-free engine module; **fixed 60 Hz accumulator-driven timestep**; static layers painted once offscreen and blitted. | Chomp *Hard constraints* |
| 12 | **Self-hosted static images permitted under `public/tetrice/`, through `asset()`. 500 KB total, 300 KB per file. Check the pixel format, not just the codec and the byte count.** The opening position is that this game ships with **no images at all** — a well, a grain and a HUD are procedural shapes. | Chomp 2026-08-03/04; Grainsnake's opening position |

**The one carried-over item that is a Tetrice-specific instance rather than a copy** is the
originality rule. Chomp carries "genre homage, not a clone" against Pac-Man and states it
in its own terms; `CLAUDE.md` carries the Tetrice instance of the same rule. The *rule* is
carried over; the *instance* is new, and it is written out in full in *What this is*
because it is the one a new contributor is most likely to break by accident, in a commit
message, in the first week.

## Hard constraints

Everything in the table above, plus the two this game adds.

### THE ENGINE'S ENTIRE STATE IS INTEGERS, AND THE TRACE IS TICK-INDEXED

Carried over from GRAINSNAKE in substance, restated because the state here is a different
shape. The simulation holds: the well's occupancy grid, the active piece's *(shape,
rotation index, x, y)*, the lock-delay counters, the bag and the PRNG state, the hold slot,
and the counters (lines, level, score, ticks). All integers. No floats anywhere in the
engine.

The render layer may interpolate — a piece may be drawn part-way between rows for smooth
fall, and a clearing row may be drawn mid-animation — using the fractional part of the
accumulator, which is a float, in the render layer, where floats have always been allowed
and are never replayed.

> **THE RULE, carried over verbatim: anything the replayer cannot reconstruct from
> `(seed, inputs, tick index)` cannot be in the format, cannot be a rule the simulation
> reads, and cannot be a stored field the server trusts.**

**Two consequences specific to this game, both of which are ways to lose determinism for
free:**

1. **A line-clear animation is a render event, not a simulation event.** The rows clear on
   the tick the piece locks, the counters update on that tick, and the next piece spawns on
   that tick (see *Gravity and lock*). If the renderer wants to spend 200 ms flashing the
   cleared rows, it does so over a state that has already moved on. An animation the
   simulation waits for is an animation length the replayer has to reproduce exactly, and
   it will be changed for aesthetic reasons by someone who does not know that.
2. **DAS and ARR — the delay and repeat rate of a held movement key — live in the input
   layer and are NEVER read by the engine.** The input layer converts a held key into
   discrete move events at specific ticks; the trace records those events; the replayer
   replays them. The engine has no concept of a key being held. This is what keeps DAS a
   *feel* tunable that anyone may change without bumping `ENGINE_VERSION`, and it is the
   difference between a tuning pass and a migration.

### THE PIECE IS READ FROM THE WELL, NOT FROM THE PIECE

*The legibility constraint, in the same position and at the same weight as chomp's four
silhouettes and grainsnake's hat contrast.*

At the cell sizes this game will actually run at on a phone — a 10-column well in portrait
is roughly a 28–34 px cell — a rice grain is a rounded shape a few pixels smaller than its
cell. The player is not reading grains. **The player is reading the skyline: which columns
are high, where the one-cell notch is, whether the surface under the active piece is flat.**
That is a read of *occupied vs empty at cell resolution*, and every render decision is
subordinate to it.

- **Grain detail may never reduce the contrast at a cell boundary.** A texture that softens
  the edge between an occupied cell and an empty one costs the player the only thing they
  are actually looking at. Detail inside a locked cell is decoration; the rim is load-bearing.
- **Locked cells and the active piece must be distinguishable without colour** — the active
  piece is the one thing on the board the player controls, and a player who has to find it
  by hue has already lost the frame. Use the treatment the site already has for this
  (fill weight and rim), and verify it in greyscale.
- The ghost piece (see *UI and presentation*) is part of this read, not an accessibility
  extra: it is how the skyline and the piece are compared without simulating gravity in
  your head at level 12.

## Route and information architecture

**TETRICE lives at `/games/tetrice`.** New route, no predecessor, so nothing redirects to
it and nothing needs to. The canonical scheme is `/games/<slug>` with no exceptions:
`chomp`, `grains`, `catch`, `grainsnake`, `tetrice`.

**IT IS A PLAY SURFACE.** It goes in `PLAY_SURFACE_ROUTES` in `src/lib/playSurfaces.ts` in
the same commit that adds the route, and `test/play-surfaces.test.ts` gains a fifth
longhand row.

The test for that list is *"does an ambient decoration fight this page?"*, never *"is it a
game"* — two of the four existing games are deliberately not on it. This game is, for three
reasons, in descending order of how much they matter:

1. **The Konami listener eats the arrow keys**, which are this game's primary control, and
   the down arrow is a scoring input here rather than merely a direction.
2. **The translate script would be a third-party request** on a route that claims zero of
   them in *Acceptance criteria*, and it is the only thing that would make that claim false.
3. A chopstick cursor and a drifting rice-particle field over a well whose whole point is
   reading occupied cells is noise on the one channel the game communicates through — see
   *THE PIECE IS READ FROM THE WELL*.

**Adding the route without adding the list entry fails SILENTLY** — nothing throws, the page
renders, and all three come back.

**`src/config/games.ts` gets one entry, and that is the whole registration.** Four surfaces
render from it — the `/games` index, the home page's Games section, the 🎮 Games dropdown
and `/games` route metadata — none of which contains a game's title, tagline or blurb as a
literal. **The count word is computed**, so this game turns "Four games, no install" into
"Five games, no install" everywhere at once, by existing. `test/one-games-list.test.ts`
asserts the absence of the literals.

### Path handling

`basePath` is `""` in production — the site owns its own domain. **Never hardcode a path
prefix, in TS or in CSS.** Use `asset()`, `BASE_PATH`, or root-relative paths.
`usePathname()` and `<Link>` are both basePath-aware, so the route strings in `games.ts`
and `playSurfaces.ts` carry no prefix.

### Testability

`vitest` here is node-env and DOM-free by design. The well, the step function, the bag, the
kick tables, the lock-delay state machine, the scoring and the replayer must be pure
functions, importable without a DOM, and unit tested. The render layer can stay untested.
`noUncheckedIndexedAccess` is off, so bounds-guard every cell lookup by hand.

Planned suites, following the existing `test/<game>-<topic>.test.ts` convention:
`test/tetrice-{well,bag,rotation,gravity,lock,score,hold,replay,topout,naming,db}.test.ts`,
plus the shared `test/canvas2d-shim.ts`, and the existing `test/play-surfaces.test.ts` and
`test/one-games-list.test.ts` gain this route.

**`tetrice-naming.test.ts` is the suite this game has that no other game needs** — see
*Acceptance criteria*.

## The matrix

- **The matrix is 10 wide × 22 tall. The top 2 rows are the spawn buffer and are NOT
  rendered. The visible field is 10 × 20.** Rows are indexed from the top: rows 0–1 are the
  buffer, rows 2–21 are visible.
- Coordinates are integer *(x, y)* with x increasing right and y increasing **down**, which
  is the direction gravity moves and therefore the direction the code reads in.
- **Spawn state is exact, because a replayer needs it exact.** Pieces spawn in their SRS
  spawn orientation with their bounding box's left edge at **x = 3**: the three-wide pieces
  (J, L, S, Z, T) occupy columns 3–5, I occupies columns 3–6, O occupies columns 4–5. The
  occupied cells sit in **row 1**, the lower of the two buffer rows (I is the exception its
  own kick table already makes it: its spawn row is row 1 as well). The piece is therefore
  fully hidden at spawn and enters the visible field on its first row of gravity.
- **Top-out condition: a newly spawned piece overlaps an occupied cell.** That is the whole
  terminator. It is checked at spawn, and it is checked identically for a piece arriving
  from the queue and for one arriving out of the hold slot.
  - **There is deliberately no separate "lock out" rule** — no condition for a piece that
    locks entirely within the buffer rows. *Decided 2026-08-12.* A second terminator is a
    second branch the replayer must reproduce, for a case the spawn-overlap check catches
    on the very next piece anyway. **Rejected for v1** on the same grounds as the scoring
    branches below: fewer terminators, one trustworthy verifier.
  - The run also ends on nothing else. There is no win state, no kill screen, no time limit.

## The pieces

Seven shapes: **I, J, L, S, Z, T, O**. Four cells each. These are the classic seven and
that is deliberate — the mechanic is the genre, and a "sixth shape" would be a different
game wearing this one's difficulty curve.

**Every cell is a grain of rice**, drawn procedurally: the shape's cells are grains packed
into the cell grid, not a bevelled square. A locked piece keeps its grains; a cleared row
is grains leaving the well.

**Colour comes from the existing `@theme` block, and the mapping is one token per shape.**
The palette has exactly seven chromatic tokens beside its neutrals, which is exactly the
number this game needs:

| Shape | Token |
|---|---|
| I | `--color-porcelain` |
| J | `--color-olive-deep` |
| L | `--color-khaki` |
| S | `--color-bamboo` |
| Z | `--color-tuna` |
| T | `--color-salmon` |
| O | `--color-olive` |

**This mapping is a starting point with a known weakness, and it is written down rather
than discovered.** Three of the seven (`olive`, `olive-deep`, `bamboo`) are greens and two
(`salmon`, `tuna`) are reds. At a 30 px cell, in a well, under a HUD, S-versus-O and
Z-versus-T are the two pairs that will fail first, and they will fail in the NEXT queue
before they fail in the well.

**HUE IS ASSUMED INSUFFICIENT. THE SECOND CHANNEL IS DECIDED NOW, AND THE GATE'S JOB IS TO
FALSIFY THAT ASSUMPTION RATHER THAN TO DISCOVER THE PROBLEM.** *Amended 2026-08-12, later
the same day. The paragraph above recorded the weakness correctly and then left the fix to
the gate, which is backwards: a gate that finds a collision at the end of the render phase
finds it when the renderer is written, and the cheapest moment to have a second identity
channel is before there is one to retrofit.*

**The second channel is the grain's long axis.** A grain of rice is an elongated shape, so
every cell already has an orientation whether or not anyone chose it — this decision is to
choose it, per shape, and to hold it fixed. Three orientations, assigned so that **no two
shapes in the same hue family share one**:

| Shape | Token | Hue family | Grain long axis |
|---|---|---|---|
| I | `--color-porcelain` | blue (alone) | horizontal |
| J | `--color-olive-deep` | green | vertical |
| S | `--color-bamboo` | green | diagonal ↗ |
| O | `--color-olive` | green | horizontal |
| L | `--color-khaki` | tan (alone) | diagonal ↘ |
| Z | `--color-tuna` | red | diagonal ↘ |
| T | `--color-salmon` | red | vertical |

- The two pairs the palette collides on are separated on this channel by construction:
  **S (↗) against O (horizontal)**, and **Z (↘) against T (vertical)**. S and Z — the mirror
  pair, and the two shapes players confuse in every implementation of this genre — get
  mirrored axes, so the cue reinforces the silhouette instead of competing with it.
- **The axis does not rotate with the piece.** It is a property of the shape, fixed in
  screen space. An axis that rotated would stop being an identity cue and become a rotation
  indicator, which the silhouette already provides for free.
- **The axis persists into the locked stack, so a settled cell still says which SHAPE put
  it there.** *Downgraded 2026-08-13, out of the Phase 1 gate, which falsified the stronger
  claim this line used to make ("which piece put it there"). The gate is the record:
  `/dev/tetrice-gate`, stacked-field panel.*
  - What survives the lock is **shape** identity, not **instance** identity. Two Z pieces
    that come to rest against each other read as one continuous diagonal mass — same hue,
    same axis, nothing between them — and at 15 px there is no boundary to find. Adjacent
    pieces of *different* shapes separate cleanly, which is the useful half and the half
    that is true.
  - *Rejected: adding a per-instance cue.* **Refused, not deferred.** Instance identity has
    no gameplay function — nothing in the rules reads which piece filled a cell, and a
    player deciding where the next piece goes is reading the skyline and the holes, not the
    lock history. And it would have to be carried on value, rim or axis, which are the three
    channels already carrying shape identity; the gate measured those at capacity (see the
    luminance ceiling below). Spending a channel that is already full on information the
    game does not use is the trade this rejects.
- Three orientations, not seven. Seven distinct angles at a 30 px cell is a code nobody can
  read; three are *categorically* different at a glance, and three is all the collisions
  require.

**THE AXIS CODE PASSED ITS GATE, AND IT PASSED FOR A REASON THAT IS NOT THE OBVIOUS ONE.**
*Added 2026-08-13, out of Phase 1. `/dev/tetrice-gate`, primary panel: S vs Z, greyscale,
15 px cell, captured at 390×844 CSS px on a DPR-3 viewport. Verdict: **distinguishable at a
glance**, and not marginally.*

The reason is written down here because the next person to consider a finer angle code will
otherwise re-derive the wrong arithmetic and reach the wrong conclusion:

- **The per-grain model predicts failure, and it is the wrong model.** A grain at a 15 px
  cell is about 9 CSS px on its long axis, so ↗ versus ↘ is roughly 6 px of end
  displacement. Reasoning from that single grain, the cue looks far too small to survive a
  phone.
- **The cue aggregates, and that is what actually carries it.** A piece is sixteen grains
  raked the same way, which is a *texture*, and orientation is one of the earliest and
  cheapest things the visual system extracts from a texture. At 90° separation between
  categories the read is immediate. The unit of the cue is the piece, not the grain.
- **The corollary, and the reason this is here rather than in a report:** narrowing the
  angles narrows the *category* separation, and the aggregation argument does not survive
  it — a texture raked at 30° against one raked at 60° is not a categorical difference at
  any cell size this game will use. So a finer code is not "the same idea with more
  values"; it is a different, weaker mechanism. **The three-way code is a floor, not a
  starting point.**

**A GREYSCALE PASS IS NOT THE MEASUREMENT, AND THE PIXEL FIDELITY IS NOT THE PHONE.** The
gate was judged on rendered pixels at 45 device px per cell, not on a phone in hand. That
is enough to settle whether the *renderer* produces the distinction; it says nothing about
whether an eye at arm's length resolves it under a phone's brightness and viewing angle.
The on-phone check is a separate open item and is listed as one in *Acceptance criteria* —
deliberately not as a parenthetical inside a criterion that is already satisfied.

**FUSION IS ANISOTROPIC. THE AXIS CODE AND THE ONE-FUSED-SHAPE RULE ARE TWO DECIDED RULES
COMPETING FOR THE SAME GEOMETRY, AND THE AXIS CODE IS CURRENTLY WINNING FOR THREE SHAPES
OUT OF SEVEN.** *Added 2026-08-13, out of Phase 1. Measured, not inferred:
`/dev/tetrice-gate`, fused-edge panel.*

A cell is a cluster of four grains in a loose 2×2, and the clusters are meant to overlap
slightly along shared cell edges so that a four-cell piece reads as **one fused shape**
rather than four beads. The gate measured what that produces once each shape's grains are
raked to a fixed angle:

| | Along the grain's own axis | Across it |
|---|---|---|
| Cluster reach past the cell boundary | **~10% over** | **~8% short** |
| What it looks like | neighbouring cells merge | a hard dark channel between them |

- **Horizontal-axis shapes (I, O) fuse into continuous bars separated by a channel between
  rows.** I at 30 px reads as two ribbons, not one piece.
- **Vertical-axis shapes (J, T) read as separate strands** — corduroy rather than a shape.
- **Diagonal-axis shapes (S, Z, L) fuse best**, because a 45° grain bridges both axes at
  once. Three of seven satisfy the rule; four do not, **and which four is decided by the
  identity cue itself.** That is the part that makes this a constraint rather than a bug:
  the geometry of the fix is coupled to the geometry of the cue.

> **THE CONSTRAINT: CLUSTER FUSION MUST BE AXIS-INDEPENDENT.** Whether a piece reads as one
> shape may not depend on which angle its grains were assigned. A mechanism that fuses
> horizontals by raking them further is not a fix; it is the same coupling with a different
> sign.

**The mechanism is deliberately NOT chosen here — that is a Phase 3 decision.** Both
candidates are named so Phase 3 starts from two options rather than from zero:

1. **A fixed cross-axis overlap term**, independent of grain orientation — the cluster
   reaches a set fraction past the boundary in *both* directions, so the spill stops being a
   function of the angle.
2. **A brick-offset lattice** — stagger alternate rows or columns of the 2×2 so grain *ends*
   never line up into a continuous channel, which removes the failure without touching how
   far anything reaches.

**They share a cost, and it is the reason this is a decision rather than a fix:** both add
overspill at the piece's outer edge, and overspill blurs the silhouette exactly where the
silhouette is doing its work — the boundary between an occupied cell and an empty one. That
trades directly against the **ghost-piece read** (an outline compared against a blurred
edge) and the **empty-cell read** (*THE PIECE IS READ FROM THE WELL*, which makes the rim
load-bearing). Neither candidate can be evaluated on the fused read alone.

**The NEXT queue renders at a larger cell than the well** — call it 1.4× — and this is
recorded here because it is free and because the queue is where a collision shows first.
The queue is the harder identification task: the piece is alone, out of context, and looked
at for a fraction of a second, while a piece in the well is read with the stack around it
and the player's own decision behind it. So the surface with the harder job gets the bigger
cell. Nothing about the well's layout constrains this; the space beside it is already there.

- **The constraint that resolves it is the section above:** shape identity is carried by
  *silhouette*, and the queue must render each piece large enough for its silhouette to
  read. Colour is the second cue, never the first. This is chomp's "four silhouettes, not
  four colours" applied to seven.
- **A palette gate runs before the render phase is called done**, in the shape grainsnake's
  board-size gate ran: the real palette, the real cell size, true CSS pixels, on a phone,
  with all seven pieces on screen at once — the queue, the hold slot and the well
  populated. Not a swatch sheet. If two pieces fail to separate, the fix is rim treatment
  or fill weight, **not a new palette token** (constraint 4) and **not the trademarked
  scheme** (*What this is*).
- The gate must include a greyscale pass, because that is the same measurement with the
  weaker cue removed, and it is the one a colour-blind player is taking.

**THE CEILING, MEASURED: HUE IS NOT A USABLE IDENTITY CHANNEL FOR EVERY PLAYER, AND IN THE
GREYSCALE CASE THE AXIS CODE CARRIES IDENTITY ALONE.** *Added 2026-08-13, out of Phase 1.
This was not a prediction — the gate produced the numbers and they are worse than the
section above assumed.*

Rec.709 luminance of the seven tokens: **I 74.3 · J 73.5 · Z 93.9 · O 104.0 · S 108.3 ·
T 176.3 · L 177.8.** Three pairs are effectively identical in value — **I/J 0.8 apart, L/T
1.5, S/O 4.3** — while per-grain value variation is **±14%**, which on a mid-tier shape is a
spread of about 30 luminance units. **The jitter within one shape is an order of magnitude
larger than the difference between two shapes**: an S grain can and does render darker than
an O grain.

So for a greyscale or colour-blind player the axis code is not the *second* channel the
section above calls it. It is the only one. It happens to resolve all three collisions —
but **by luck rather than by design**: the axis was assigned against *hue families*, and
luminance proximity is a different partition of the same seven shapes that it lines up with
by coincidence. A palette edit that is obviously safe on hue can break it silently.

**This is enforced by a test rather than by this paragraph** — see
`test/tetrice-palette.test.ts` in *Acceptance criteria*. A prose rule asks a future palette
edit to remember; the test refuses it.

- **The threshold is a luminance RATIO of 1.33, and the number comes from the ±14% spread
  rather than from taste.** A shape's grains occupy `[0.86·L, 1.14·L]`. Two shapes are
  confusable exactly when those bands overlap, which is `max/min < 1.14/0.86 = 1.326`. Any
  future change to `VALUE_SPREAD` changes this threshold, and the test derives it from that
  constant rather than hard-coding 1.33, so the two cannot drift apart.
- **The assertion is PAIRWISE, not tier-based, and that is a correction to the obvious
  design.** Clustering into tiers by single linkage chains through intermediate shapes: Z
  (93.9) is band-adjacent to both I (74.3) and O (104.0), so I, J, Z, O and S merge into one
  "tier" containing both I and O — which are **both horizontal** and would fail the
  assertion, despite being 1.40 apart and genuinely not confusable. That is a false alarm on
  a palette that is fine, and a test that cries wolf is a test somebody deletes. The
  question the game actually asks is "can *these two* be confused", so the test asks it
  about pairs.

**WHERE THE GATE AND ITS EVIDENCE LIVE.** *Added 2026-08-13.*

- **The gate page is `/dev/tetrice-gate`** (`src/app/dev/tetrice-gate/`, renderer in
  `src/components/tetrice-gate/`). It is unlinked, `noindex`, and a play surface — the
  ambient decoration would sit on top of the exact pixels being judged. Because it is a
  play surface without a card in `src/config/games.ts`, it is also named in
  `UNLISTED_PLAY_SURFACES` inside `test/play-surfaces.test.ts`.
- **It is throwaway, and it is kept anyway until Phase 3**, because the fusion constraint
  above is accepted by re-running it. **PHASE 6 DELETES IT** — the route directory, the
  component directory, the `PLAY_SURFACE_ROUTES` entry and the `UNLISTED_PLAY_SURFACES`
  entry, in one commit.
- **The captures live OUTSIDE the repo**, at
  `/home/deploy/onegrainofrice-asset-sources/tetrice-gate/`, beside the mood board (*What
  this is*). They are unbudgeted images and `public/` is served wholesale, so they are not
  committed — the size budget in constraint 12 is a budget on what ships, and evidence for a
  decision is not something that ships.

## The randomizer

**7-bag. Shuffle all seven shapes, deal all seven, reshuffle.** A shape is never more than
twelve pieces away, and the player can count.

**WHAT THE BAG GUARANTEES, EXACTLY — AND THE THING IT DOES NOT, WHICH LOOKS LIKE A BUG.**
*Added 2026-08-13, out of Phase 2. The line above ("never more than twelve pieces away")
was already correct and is now pinned by `test/tetrice-bag.test.ts`; what was missing is the
adjacent claim that everyone reaches for and that is false.*

| Property | Holds? |
|---|---|
| Every **aligned** window of 7 (pieces 0–6, 7–13, …) contains each shape exactly once | **Yes** — that is what a bag is |
| Every **sliding** window of 7 contains each shape exactly once | **NO**, and it must not |
| Maximum gap between two occurrences of a shape | **12 pieces**, and the bound is tight |
| Every sliding window of **14** contains all seven | **Yes** |

**Straddling duplicates are correct behaviour, not a defect.** A 7-bag permutes *within* a
bag. Nothing stops a shape being last out of one bag and first out of the next, so a
window that straddles the boundary legitimately holds it twice — an S immediately after an
S is the bag working, not the bag broken.

This is written down because the "fix" is obvious, cheap and wrong: constraining the
boundary (re-rolling a repeat, or forbidding a shape from opening a bag if it closed the
last one) makes the sequence *more* predictable, changes the drought distribution the
difficulty curve was tuned against, and is an `ENGINE_VERSION` bump that silently rescores
nothing while quietly changing every future run. `test/tetrice-bag.test.ts` therefore
**asserts that straddling duplicates occur**, so the property cannot be removed by someone
who believes they are removing a bug.

- *Rejected: pure random.* Independent uniform draws produce droughts — the wait for an I
  is geometric, so a run in ten will wait more than twenty pieces for one — and a drought
  does not read as variance, it reads as broken. The player concludes the game is cheating,
  and they are not wrong to, because a rule that produces indistinguishable-from-malicious
  output is a bad rule regardless of its expectation. **Rejected.**

**The RNG is a seeded 32-bit PRNG (xorshift32), deterministic from a single integer seed.**
One generator, one state word, no `Math.random()` anywhere in the engine — including in
tests, which is how a stray call gets in.

- The bag is shuffled with a Fisher–Yates using that generator, and **the shuffle
  implementation is part of `ENGINE_VERSION`**: swapping the loop direction produces a
  different, equally valid shuffle and silently changes every stored replay.
- The queue is filled ahead far enough to show four NEXT pieces (*Hold and the NEXT queue*),
  which means the generator runs ahead of the piece in play. The replayer must run it ahead
  by the same amount, so **the lookahead depth is an engine constant, not a UI constant.**

**The seed comes from the server at run start. It never comes from the client.**

- *Rejected: client-chosen seed.* A client that picks its own seed can shop for one — run a
  thousand seeds offline, keep the one that deals four I pieces into a flat well, play that.
  The board then ranks luck the player selected rather than luck they were dealt. **Rejected.**
- **This is the one place TETRICE deliberately diverges from `grainsnake-spec.md`.** That
  file names a server-issued seed as "the one thing that would move the boundary" and
  defers it, because it puts a request in front of every run. Tetrice takes it, because the
  cost/benefit is not the same game: grainsnake's seed determines where food appears, which
  a strong player routes around; **this game's seed determines the entire sequence of
  pieces, which is the single largest input to a score.** Seed shopping is not a marginal
  advantage here, it is the dominant strategy.
- **The mechanics of it, so that the rule is enforceable rather than decorative.** *Decided
  2026-08-12; this was not in the brief, and it is written out because "the seed comes from
  the server" means nothing unless the server can later tell that it did.*
  - `POST /api/tetrice/seed` issues `{ seed, engineVersion }` and records the issue —
    seed, `vid`, issue time, unused — in `tetrice.db`.
  - A score submission carries the seed it was issued. The score route **rejects a seed it
    did not issue, a seed already spent, and a seed issued to a different `vid`.**
  - The issue time gives a trusted lower bound on the run's wall-clock duration, which
    catches a trace replayed at a thousand times real speed. That is the property
    grainsnake deferred, acquired here as a side effect. It still does not catch a bot
    playing at human speed — see *Anti-cheat*.
  - **A failed seed request does not block play.** The run starts on a locally generated
    seed and is **unranked**: the HUD says so, and the score route refuses it because the
    seed is not one it issued. Blocking the game on a network call would be a guard that
    takes the game down when the API has a bad minute, which is constraint 7.

**SINGLE-USE AND BOUND-TO-VID STOP SEED *REUSE*. THEY DO NOT STOP SEED *SHOPPING*, WHICH IS
THE THING THIS DECISION EXISTS TO STOP.** *Amended 2026-08-12, later the same day, out of
Lito's review. The hole is recorded rather than quietly patched, because the checks that
miss it all pass, which is exactly why nobody would find it by reading the route.*

The mechanics above catch a seed submitted twice and a seed submitted by someone it was not
issued to. Neither is the attack. The attack is:

> Request a hundred seeds. Replay each one offline against our own engine — the client has
> to hold the engine in order to draw the game, so evaluating a bag costs milliseconds and
> no network. Keep the one that deals a friendly opening. Play only that one. Discard the
> other ninety-nine.

**Every submission from that player is a distinct, unspent, correctly-bound seed, so every
check above returns green.** The dominance problem is untouched: the board still ranks luck
the player selected. Three mitigations, one of which carries the weight:

1. **ONE LIVE SEED PER VID. ISSUING A NEW SEED VOIDS THE PREVIOUS ONE.** This is the
   load-bearing mitigation and the other two are support. It does not make shopping
   impossible — nothing does, for a client that holds the engine — it makes it **serial**:
   discarding a candidate costs the ability to hold it, so a hundred candidates cost a
   hundred round trips, in sequence, each visible. That is the difference between an
   optimisation anyone would run and one somebody has to want.
2. **A SEED EXPIRES 90 SECONDS AFTER ISSUANCE IF IT HAS NOT BEEN STARTED.** *The clock is
   the one already on the row* — the same `issued_at` the wall-clock lower bound reads — so
   this costs no new machinery, no new column and no new call.
   - 90 s is far longer than a page load plus a player pressing a key, and far shorter than
     "later". It makes a seed something you play **now** rather than something you bank, and
     it composes with mitigation 1: the shopper cannot hold one good candidate while
     evaluating the next, because requesting the next one voids the one they are holding.
   - **The TTL is on issuance→start, NOT on issuance→submission**, and the distinction is
     the whole reason the number can be this tight: a real run is long, and a submission
     deadline of 90 s would reject every honest player who lasted two minutes. The
     submission deadline is a separate, generous bound derived from the tick cap —
     `start + tickCap/60 + 10 minutes` — so it comes from the one number that is already
     measured rather than from a second invented one (*Anti-cheat*, bounds).
3. **RECORD THE ISSUANCE-TO-SUBMISSION RATIO PER VID. THIS IS OBSERVABILITY, NOT A BLOCK.**
   A player who burns forty seeds to submit one run should be one query away from visible.
   - **There is deliberately no enforcement threshold**, and this is a decision rather than
     an omission: nobody knows where the line sits, a guessed threshold would ban the
     player who opens the page and walks away four times as readily as a shopper, and a
     guard whose false positives are indistinguishable from its true positives is
     constraint 7 in a different costume. Watch the distribution first. If a threshold is
     ever added it will be added against real data, and it will still warn before it
     refuses.

**THE TWO-TAB FAILURE MODE, AND WHERE THE VOID LANDS.** Mitigation 1 creates a failure the
player can hit without cheating: two tabs open, the second tab loads, its seed request
voids the first tab's **live run**, and that run — several minutes in — becomes unsubmittable
for a reason nothing on screen can explain.

- **CHOSEN: the void lands at FIRST INPUT.** A newly issued seed is *pending* and voids
  nothing. It becomes **live** on the run's first input, and *that* is the moment the
  previous seed is voided. Per vid there is at most one live seed and at most one pending
  seed — requesting a third voids the pending one, never the live one. A second tab
  therefore costs nothing until somebody actually plays in it, which is the moment the
  player has told us which run they mean.
  - The start signal is one fire-and-forget beacon, and **its failure mode is bounded and
    fails in the safe direction**: a lost beacon means the predecessor is never voided, so
    the vid holds one extra seed. Not a run killed, not a submission refused. Voiding is
    what the submit path checks; startedness only decides *which* seed gets voided.
  - This preserves mitigation 1 exactly. A shopper cannot bank candidates by beaconing them
    all live, because each beacon voids the previous live seed — the invariant is one live
    seed, however it got there.
- *Rejected: the void lands at issuance.* One state transition instead of two, no beacon,
  no `started_at` column. **Rejected**, and implementation cost was not allowed to be the
  argument: it makes *opening the game in a second tab* a destructive act on a run in
  progress, with no error the first tab could show because nothing there has failed yet.
  A guard that kills a live honest run to make a shopper's life marginally harder is the
  wrong trade in the same direction constraint 7 names.

## Rotation

**SRS — the Super Rotation System — with the standard JLSTZ kick table and the separate I
kick table.** Both tables are data, in `engine/rules.ts`, beside `ENGINE_VERSION`.

- Each piece has four rotation states (0, R, 2, L). A rotation input tries the naive
  rotation first, then each offset in the kick table for that *(from, to)* transition in
  order, and takes the first that does not collide. If all fail, **the rotation does not
  happen and nothing else changes** — no lock-delay reset, no counter.
- **O does not rotate.** Its four states are identical, so rotating it is a no-op — and a
  no-op does not reset the lock delay. That is not an O-piece rule; it is one instance of
  **A RESET REQUIRES A STATE CHANGE** in *Gravity and lock*, which is where all three
  instances live. *Amended 2026-08-12: this was written here as an O-piece special case,
  which was the wrong altitude — the wall case below is the common one and would have been
  missed.*
- *Rejected: naive rotation with no kicks.* Rotation against a wall or a surface simply
  fails, which removes the entire vocabulary of tucks and spins that makes a well
  recoverable, and makes the game feel like it is refusing inputs rather than obeying
  physics. It is also the version every player who has played anything else in the genre
  will immediately notice. **Rejected.**
- SRS's kick tables are a published, widely reimplemented specification of *rotation
  behaviour* — the offsets, not anyone's art or code. Implement them from the tables, in our
  own code, under our own names.

## Gravity and lock

**Fixed 60 Hz simulation**, accumulator-driven, decoupled from `requestAnimationFrame`
(constraint 11).

**Gravity is authored in frames-per-row.** Not rows per second, not cells per second, not
milliseconds — the same lesson grainsnake recorded twice: *only `60/n` is representable*,
and a value authored in any other unit is a value the simulation rounds and the replayer
disagrees about.

**One row per tier, level 1 through 15, then flat:**

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Frames/row | 48 | 43 | 38 | 33 | 28 | 23 | 18 | 13 | 8 | 6 | 5 | 4 | 3 | 3 | 2 |

- **These thresholds are the tuning lever.** They are the numbers to change when the curve
  feels wrong, and they live in `engine/rules.ts`. **Changing any of them is an
  `ENGINE_VERSION` bump** (*Run lifecycle*).
- **The floor is 2 frames/row, not 1, and that is a decision.** At 1 frame/row a piece
  crosses the twenty visible rows in 333 ms. A DAS charge plus a walk from the spawn
  columns to either wall costs roughly that, so at 1 f/row parts of the well would be
  **unreachable by any input** — the level would not be harder, it would be a different
  game with five reachable columns. A tier that removes reachability is a kill screen
  rather than a difficulty step. **2 f/row keeps the full width reachable on one charge.**
- **The table stops at 15; the level does not.** Level keeps climbing forever because it is
  a scoring multiplier (*Scoring*). Past 15 the pressure comes from the player's own stack,
  which is where a puzzle game's difficulty is supposed to come from.

**Lock delay: 30 frames, reset on a successful move or rotate, maximum 15 resets, then a
forced lock.**

- The timer starts when the piece cannot move down. A successful lateral move or rotation
  restarts it and spends one of the 15 resets. When the resets are exhausted the piece
  locks on the next expiry regardless of input.
- **A RESET REQUIRES A STATE CHANGE.** *Generalised 2026-08-12, later the same day. This
  was written as a rotate-on-O special case in* Rotation, *which is the rarest of its three
  instances and the least likely to be hit — stating it as a rule is what makes the other
  two obvious instead of two more bugs.* An input that is accepted but changes nothing is
  **not** a successful move or rotate, does not restart the 30-frame timer, and does not
  spend one of the 15 resets. The three instances:

  1. **A rotate input on an O.** All four states are identical, so the rotation is a no-op.
     Rarest of the three, and the one that reads as deliberate cheating when it works: an O
     resting on the surface held in place indefinitely by tapping rotate.
  2. **A move into a wall — or into the stack — that does not move the piece.** **This is
     the common one, and it is common by a wide margin.** A player holding left at the well
     edge is not an edge case, it is what everybody does while deciding: DAS keeps firing
     move-left events, every one of them is refused by the wall, and if a refused move
     counted as a reset the piece would sit there until the 15-reset cap forced it down —
     **7.75 seconds** of a piece not falling while the player is doing nothing unusual.
     (*The figure was "roughly 8 seconds" until 2026-08-13; see the corrected bound below.
     It is written out here too because a derived number in prose outlives the table it was
     derived from.*)
  3. **A rotation whose every SRS kick failed.** The rotation did not happen (*Rotation*),
     so nothing about the state changed and nothing resets.

  The engine's move and rotate functions therefore **return whether they changed anything**,
  and the lock-delay code reads that return value rather than the fact that an input
  arrived. An implementation that resets on *input* passes every test that only ever moves
  a piece in open space.
- A downward move needs no special case: while the piece can move down, the lock timer is
  not running.
- **The worst-case stall is bounded, and the number is 465 frames — 7.75 seconds on one
  piece, at any level.** *Corrected 2026-08-13, out of Phase 2, where the engine measured
  it. This read "30 frames plus 15 resets of 30 frames is 480 frames — 8 seconds", which is
  the arithmetic anyone would do and it is one frame per cycle too generous.*
  **The frame a reset is spent on is also the first frame of the delay it starts**, so only
  the first cycle costs a full 30 frames and every later one costs 29. That single sentence
  is the reason; without it the obvious arithmetic restores 480 on the next read.

  | | |
  |---|---|
  | First cycle (timer −1 → 29, then the reset frame) | 30 |
  | 14 further reset cycles, 29 each | 406 |
  | Final wait, timer 1 → 30 | 29 |
  | **Total** | **465 frames = 7.75 s at 60 Hz** |

  That is the ceiling on infinity-spin. It is generous on purpose; the cap exists to make
  the game terminate, not to punish a player who is thinking. The number is pinned by
  `test/tetrice-lock.test.ts`, which asserts the exact frame count rather than a bound —
  the arithmetic is the thing being protected.
- **Hard drop bypasses all of it** and locks on the tick it lands (*Scoring*).

**Level up every 10 lines cleared.** `level = 1 + floor(totalLinesCleared / 10)`, evaluated
after each lock.

**No entry delay, no clear delay.** *Decided 2026-08-12; not in the brief, decided here
because the tick model is incomplete without it.* On the tick a piece locks: the rows clear,
the counters update, and the next piece spawns — all in that one tick. Authored ARE and
line-clear delays are two more frame counts the replayer must reproduce exactly, in
exchange for feel that this game can get from the renderer instead (constraint: *a
line-clear animation is a render event*). **Rejected for v1.**

## Scoring

**Line clears, multiplied by the level:**

| Rows cleared | Base | At level 1 | At level 10 |
|---|---|---|---|
| Single | 100 | 100 | 1,000 |
| Double | 300 | 300 | 3,000 |
| Triple | 500 | 500 | 5,000 |
| Quad | 800 | 800 | 8,000 |

- **The multiplier is the level the piece was PLAYED under** — the level *before* the lines
  from this same lock are counted toward the next level-up. *Stated because it is exactly
  the kind of ambiguity that produces a verifier which disagrees with the client on one
  submission in fifty, on the run that crossed a level boundary.* Order per lock: clear
  rows → score them at the current level → add them to the line total → recompute level.
- **Soft drop: 1 point per cell.** **Hard drop: 2 points per cell.** Both count cells
  actually travelled, and both are awarded by the engine as the cells are traversed, so the
  replayer derives them from the same inputs rather than being told.
- Hard drop moves the piece to its resting position and **locks it on that tick**, with no
  lock delay and no reset.

**Three scoring branches are rejected for v1, and the reason is the same one for all
three:**

| Branch | Rejected for v1 because |
|---|---|
| **T-spin bonus** | Detecting a T-spin is a rule about *how* the piece arrived — a corner test plus a "last action was a rotation that kicked" flag — which puts a second piece of history into the state the replayer must reproduce exactly, and the T-spin-mini distinction doubles it again. |
| **Back-to-back bonus** | A carried flag across locks. Cheap to write, and every scoring path now depends on a bit set several pieces ago, which is a divergence that survives silently until the one run where the client and the server disagree about when it cleared. |
| **Combo counter** | A second carried counter with its own reset rule, multiplying a score the verifier is trying to reproduce to the point. |

> **v1 is about getting the replay verifier trustworthy.** Every scoring branch is a branch
> the verifier has to reproduce exactly, and a verifier that is wrong on one run in fifty is
> worse than no verifier, because it rejects honest players and teaches everyone to
> distrust the board. These are **deferred, not refused** — each becomes cheap once the
> verifier is proven, and each is an `ENGINE_VERSION` bump when it arrives.

**Every tuning number** — the gravity table, the lock-delay frames and reset cap, the
line-clear values, the drop values, the lookahead depth — lives in one `engine/rules.ts`
beside `ENGINE_VERSION`. No magic numbers in engine code. Durations are authored in frames,
because frames are what the simulation reads.

## Hold and the NEXT queue

**There is a hold slot: one piece, one swap per lock.**

- Pressing hold swaps the active piece with the held one. If the slot is empty, the active
  piece goes in and the next piece is pulled from the queue.
- **One swap per lock.** The swap is spent when used and refreshed when a piece locks —
  otherwise hold is a free infinite shuffle between two shapes and the piece in play stops
  being a commitment, which is the game's whole skill (*What this is NOT*).
- The incoming piece **arrives in its spawn state at the spawn position**, not in the
  rotation or column the outgoing piece was in. It is a spawn, and it takes the spawn
  check: **a hold that spawns onto an occupied cell is a top-out**, by the same rule and the
  same code path as a piece from the queue (*The matrix*).
- Hold does not reset the lock delay and does not count as a move or a rotation.

**NEXT shows 4 upcoming pieces**, matching the mood board (*What this is* — it lives
outside the repo and is advisory). Four is a full half-bag of
lookahead: enough to plan a well, not so much that the plan is written for you.

**The HUD gains a hold box below the NEXT queue.** *This is a deliberate departure from the
mood board, which has no hold box* — the board is advisory and hold is a mechanic, so the
mechanic wins. Below rather than above because NEXT is read every piece
and hold is read every few, so NEXT keeps the position closest to the well.

## Run lifecycle

- **One run, one life, no continues.** The run ends on top-out and on nothing else
  (*The matrix*).
- **Pausing is allowed, and it freezes the input log's frame counter.** The accumulator
  stops accumulating and its fraction is frozen (the two separate freezes grainsnake
  records), the tick counter stops, and no tick is written to the trace while paused. So
  pausing buys thinking time and **nothing else** — it cannot advance the game, cannot be
  used to gain a frame, and does not appear in the trace at all. There is no
  pause-for-advantage because there is no advantage in it.
- On resume, the simulation continues from the tick it stopped on. A replay of the trace
  has no way to tell the run was ever paused, which is correct: the pause was not part of
  the game.

**`ENGINE_VERSION` is an integer constant starting at 1**, living in `engine/rules.ts` next
to the tunables it describes, because that is the file someone is editing when they need to
bump it. Carried over from grainsnake in full, including the parts that are easy to skip:

- It is written to every `tetrice_runs` row at submit time.
- **The replayer refuses a trace whose `engine_version` it does not implement. Refuses — it
  does not rescore, and it does not guess.**
- **Any change to a number the simulation reads is a bump.** The gravity table, the lock
  frames, the reset cap, the kick tables, the shuffle, the lookahead depth, the line-clear
  values, the matrix dimensions. If it is in `rules.ts`, changing it bumps the constant
  beside it.
- **Verification happens once, at submit time. A bump invalidates nothing.** Stored rows are
  never re-verified and never rescored; there is no code path that recomputes a stored
  score, and the absence of one is the design. Old rows simply stop being re-verifiable,
  which is the honest state and costs nothing.
- The board can therefore hold rows from several engine versions at once, and it will. That
  is the caller's problem, not the storage layer's; the escape hatch, if it ever bites, is a
  display-side version marker or a filtered board — both presentation changes over data
  already stored correctly.

## Controls

- **Keyboard:** left/right arrows and A/D to move; up arrow and X to rotate clockwise; Z and
  Ctrl to rotate counter-clockwise; down arrow and S to soft drop; space to hard drop; C and
  Shift to hold; `P` or `Esc` to pause.
- DAS and ARR live in the input layer (*Hard constraints*) and are UI tunables. Their
  defaults are chosen by feel and may be changed without an `ENGINE_VERSION` bump — but see
  the reachability arithmetic in *Gravity and lock*, which is the one place a DAS change has
  a gameplay consequence worth checking.
- **Touch:** the game must be genuinely playable one-thumbed in portrait. Tap left/right
  halves to move, tap the piece to rotate, swipe down to soft drop, flick down to hard drop,
  and an explicit on-screen hold control. The touch mapping is decided in the phase that
  builds it, against a real phone, and it is not a d-pad by default — grainsnake's d-pad
  defaults off for a reason.
- **A control that cannot be reached at level 12 does not exist.** Every control is
  measured at the fast end of the table, not the slow end.

## Sound

Generated at build time by the repo's existing `scripts/gen-sfx.mjs` and played through
`src/lib/sound.ts`, self-hosted at `public/sfx/tetrice-*.wav` and subject to the size budget
(constraint 12). Nothing is fetched at runtime.

The events that need a sound: move, rotate, soft-drop lock, hard drop, line clear (with a
distinct one for a quad), level up, hold, top-out. **Locking is the one that matters most** —
it is the confirmation that a commitment has been taken, and it is the sound a player will
hear several thousand times in a session, so it is the one to make quiet and short.

## UI and presentation

- **The panel reads "TETRICE / ONE GRAIN OF RICE".** Two lines, in the site's display face.
  The mood board's title block is not reproduced (*What this is*).
- **The layout is specified here, in prose, and this paragraph is the authority** — the mood
  board lives outside the repo and is advisory (*What this is*). The well is centred, the
  NEXT queue sits beside it and renders at ~1.4× the well's cell (*The pieces*), the hold
  box sits below NEXT, and score/level/lines sit in a HUD that does not move or reflow as
  its numbers grow — a HUD that reflows at 10,000 points is a HUD that moves the well
  mid-run.
- **The ghost piece is on by default**: the resting position of the active piece, drawn in
  outline in the well. It is part of the legibility contract (*Hard constraints*), not a
  difficulty setting. It may be toggled off; it is not off by default.
- Letterboxed to the well's aspect and scaled by `devicePixelRatio` (capped). The well, the
  HUD frame and anything else static are painted once into an offscreen canvas and blitted.
- The visible field is 10 × 20 and the buffer rows are **not rendered** — not dimmed, not
  faded, not shown. A piece appears at the top edge, which is what every player of this
  genre expects, and rendering the buffer would show them a piece that the rules treat as
  not yet on the board.

## Leaderboard

Its own database, its own API namespace, and **nothing shared with the other games except
the identity cookie** (constraint 6).

- **`data/tetrice.db`.** Not `chomp.db`, not `grains.db`, not `grainsnake.db`. One file, one
  writer. The naming pattern is the existing one — `data/<game>.db`, defaulting to
  `path.join(process.cwd(), "data", "tetrice.db")`, with a `TETRICE_DB_PATH` override.
- **Single-writer contract, enforced by a DECLARATION.** `TETRICE_DB_OWNER=1` in
  `ecosystem.config.js`'s env block for the `onegrainofrice` app — **never in `.env.local`**,
  because the preview server runs from the same working directory and reads the same
  `.env.local`, so a flag placed there is inherited by the very process the guard exists to
  catch. A process that has not declared ownership refuses the default path with a message
  naming its own fix; an explicit `TETRICE_DB_PATH` is always honoured, because naming a
  file is taking responsibility for it.
  - **Shipping this board is a two-file env change**, and the second file is the one that
    gets forgotten: `ecosystem.config.js` **and** the preflight loop in `deploy/promote.sh`,
    which currently checks `CHOMP_DB_OWNER` and `GRAINSNAKE_DB_OWNER` only. A plain
    `pm2 restart` does not re-read the config file, so without the one-time
    `--update-env` restart every `/api/tetrice/*` request 500s. The preflight **warns and
    never refuses** (constraint 7).
- Tables `tetrice_runs` (append-only audit trail, holds the trace and `engine_version`),
  `tetrice_players` (denormalised best-per-player, so the board is one indexed read), and
  `tetrice_seeds` (issued seeds, for *The randomizer*). `UNIQUE(vid, trace_hash)` makes
  dedupe a database property rather than a check someone can forget to run. One
  `handle.transaction()` per multi-table write.
- **One board, top 50, by best single run.** The row carries **score, lines and level** —
  `best_lines` sits where grainsnake's board has `best_length`. Flag beside the name from
  the country stored on the *write*; no country board.
- **Identity is the existing signed `grain_vid` cookie**, HttpOnly, minted by
  `/grains/session`, read from the cookie header rather than from a field. **No new
  secrets**: the cookie secret and the IP salt are read through `getGrainsEnv()`.
- Name prefill follows chomp's and grainsnake's: this game's name if there is one, else the
  name they chose on the grains board, read from `grains.db` **`readonly: true`** so this
  feature cannot write it even by accident. Names go through `checkName` from
  `src/lib/chomp/score.ts` (constraint 9) — not a copy of it.
- **HTTP, not a WebSocket.** A score is one discrete event per run.
- `no-store` on every route. Rate-limited per vid and per IP hash, in the same shape and
  with the same honest note that the vid bucket is a speed bump and the IP bucket is the
  real ceiling. **The seed route is rate-limited too**, and more tightly than the score
  route: it is the cheapest thing on the site to call in a loop.

## Anti-cheat

The client is validated the way grainsnake's is — the server re-derives every number, the
name is re-sanitized whatever the browser did to it, the country comes from nginx rather
than the payload, and the duration is DERIVED from `ticks` rather than accepted.

**This game replays, from the phase that ships the board.** Its state is *(grid, active
piece, counters, bag, PRNG, hold)*, all integers, and **the replayer is the step function** —
the same module, imported by the route handler, run without a canvas. There is no second
implementation to drift.

- `POST /api/tetrice/score` re-simulates `(seed, trace)` and **computes the score itself**.
  The submitted score is compared against the computed one and the *computed* one is stored.
- A submission whose trace does not produce its claimed score is **rejected** — not flagged,
  not stored-and-sorted-later. The run stays playable.
- **The replay format is tick-indexed. It contains `(seed, inputs, tick index)` and nothing
  else.** No timestamps, no `elapsedMs`, no `startedAt` — **absent from the format**, so
  there is no field for one to arrive in. The accumulator clamp makes any time-typed field a
  client/server divergence by construction. Duration is derived server-side as
  `ticks × 1000 / 60`.
  - The one time-typed value in this game is the **seed issue time**, and note where it
    lives: on the server's `tetrice_seeds` row, written by the server, never in the format
    and never trusted from the client. That is the distinction — the format holds nothing
    time-typed; the server may know things about its own clock.
**THE VERIFIER MUST NOT INHERIT THE ENGINE'S FORGIVENESS. TRAILING INPUT PAST TOP-OUT IS A
422.** *Added 2026-08-13, out of Phase 2, and written now rather than in Phase 5 because by
then the permissive behaviour will look like a decision the route was built on.*

`step()` **no-ops on input after a run is over**: it returns the state unchanged, does not
advance the tick count, and does not throw. That is right for the engine — a client looping
a frame counter to the end of a trace runs past the tick the run ended on, and that is
ordinary rather than a bug, so the engine has nothing to protect there.

**It is wrong for the route handler, and for exactly the same reason.** A submitted log
carrying entries past the top-out tick would replay to a perfectly valid-looking score with
the trailing junk silently absorbed — the verifier would compute the right number and
accept a payload it never actually examined. Permissiveness in the simulation becomes a
blind spot in the check, which is the general shape of this failure and not a quirk of this
one function.

- `POST /api/tetrice/score` **rejects a trace whose last entry falls after the tick the
  replay topped out on**, with a 422. Not truncated, not ignored: refused.
- The reason it is a 422 rather than a silent trim is that an honest client cannot produce
  one. The run ends on a tick the client knows about, because it is the tick that drew the
  game-over card. A log that keeps going is a log that was assembled rather than played.
- **The verifier asserts the tick count it derived, not the one it was handed.** Duration
  comes from the replayed tick count (`ticks × 1000 / 60`), so a trace padded past the end
  cannot inflate it either.
- `test/tetrice-replay.test.ts` covers this with a **known-bad trace**: a valid run with
  ten junk entries appended must be refused. A checker that accepts everything passes a
  suite of valid runs perfectly.

- **Bounds are measured, not guessed.** The tick count and the trace-entry count are capped
  and checked *before* simulating, because a trace is an input to a loop that runs on the
  web process. The cap comes from a real long run in `test/tetrice-replay.test.ts` plus
  headroom. Note that this game's ticks-per-input ratio is unlike grainsnake's: a
  competent player inputs several actions per second for a run that can last a very long
  time, so the entry cap is the binding one here, not the tick cap.

**THIS IS NOT ANTI-CHEAT, AND THE SECTION IS NAMED WRONG ON PURPOSE SO THAT NOBODY GETS TO
SKIM IT.** Carried over from grainsnake, and it is *more* true here:

> **It eliminates FORGED scores. It does not eliminate BOTS.**

The client necessarily holds the seed, because it has to simulate the run in order to draw
it. A client that can simulate can also search — and this genre has a decades-deep
literature of solvers that play it better than any human. A headless player can compute a
near-perfect placement sequence and submit a trace that replays flawlessly, and **it should
pass, because it is a real run of this game.** The honest claim is "every score on this
board is the score of a real run", never "of a human". Anything on the page implying
otherwise is wrong.

**WHAT THE SERVER-ISSUED SEED DOES AND DOES NOT PREVENT.** *Amended 2026-08-12, later the
same day. The previous text here claimed the seed "narrows this by exactly one thing" and
left the rest to the reader, which implied more than the mechanism delivers — see* The
randomizer, SINGLE-USE AND BOUND-TO-VID…

| | |
|---|---|
| **Prevents** | Playing a seed the server never issued — the whole class of "I picked my own bag". |
| **Prevents** | Submitting the same seed twice, or a seed issued to another `vid`. |
| **Prevents** | *Banking* candidate seeds. One live seed per vid means a discarded seed cannot be kept, so candidates can only be tried in sequence, one round trip each. |
| **Prevents** | A trace submitted faster than it could have been played. The `issued_at` clock is a floor under the run's wall-clock duration, so a thousand searched runs cannot be submitted in the time one run takes. |
| **Does NOT prevent** | **Seed shopping as such.** A client that can draw the game can evaluate a bag, and nothing stops cycling seeds one at a time to find a friendly opening. The mitigations make it serial, time-boxed and countable — they do not make it impossible, and no design that ships the engine to the browser can. |
| **Does NOT prevent** | **Bots.** A solver that plays at human speed, on a seed we issued, submitting a trace that replays perfectly, is indistinguishable from a strong player *because it is a real run of this game*. |
| **Does NOT prevent** | A player farming seeds and never submitting. That is not an attack, it is a query result — see the ratio in *The randomizer*. |

The honest claim on the page stays exactly what grainsnake's is: **every score on this board
is the score of a real run**, never "of a human", and now with one clause added — never "of
an unchosen bag" either.

## Acceptance criteria

- 60 fps on a mid-range phone; no GC stutter. **The well is a preallocated typed array, not
  an array of row arrays that gets spliced** — a line clear must not allocate, and it is the
  one operation here that runs on a frame the player is already under pressure on.
- **Deterministic**: identical inputs produce an identical run regardless of frame rate,
  device or process. Run the same `(seed, trace)` twice and diff the final state; run it
  once in the browser and once in Node.
  - **Asserted at a simulated 120 Hz and 45 Hz, not only at 60.** A frame-counting bug
    produces a perfectly deterministic run at every refresh rate — it just produces a
    *different* one at each, and a test that only ever feeds the loop 16.67 ms frames would
    pass on the broken version. Drive the accumulator with 8.33 ms and 22.2 ms frames and
    assert the same final state.
- **TOP-OUT IS ASSERTED POSITIVELY, NOT ONLY NEGATIVELY.** Carried over from the 2026-08-08
  lesson on grainsnake, where removing the walls failed zero of 517 tests because every
  assertion said `expect(dead).toBe(false)`. `test/tetrice-topout.test.ts` asserts a run
  that **must** top out, topping out for the named reason — a spawned piece overlapping an
  occupied cell — on a tick derived from the gravity table rather than hardcoded. Every
  topping-out case is paired with the nearest surviving one (a stack one row lower, a hold
  swap into a well that just barely fits), because "it ended" is satisfied by an engine that
  ends every run and "it survived" by one that never ends.
- **The replay checker rejects a tampered trace.** Run it against the failure, not only
  against valid runs — a checker that accepts everything passes a suite of good runs
  perfectly.
  - *Added 2026-08-13:* **including a trace with trailing input past the top-out tick**,
    which is the one tampering the engine itself will not notice — `step()` absorbs it
    silently by design (*Anti-cheat*). 422, not a truncation.
- **A seed the server did not issue is rejected**, and so is a seed spent twice. Asserted
  against the route, both directions.
  - *Added 2026-08-12 with the shopping amendment (*The randomizer*).* Also asserted: a
    **voided** seed is rejected, and a seed that was **never started within its 90 s TTL**
    is rejected.
  - **The two-tab case is asserted as a passing case, not only as a failing one.** Issue
    seed A, start it, issue seed B, and assert **A is still submittable** — B voids A only
    when B takes its first input. This is the assertion that fails on the
    void-at-issuance implementation, which is the whole reason the choice was written down.
- **A REFUSED INPUT DOES NOT RESET THE LOCK DELAY, ASSERTED ONCE PER INSTANCE.** *Added
  2026-08-12 with the generalisation in* Gravity and lock. Three tests, because one test
  covering "the rule" would be written against whichever instance the author had in mind
  and would pass on an engine that gets the other two wrong:
  1. **Rotate on a resting O** — tap rotate every frame and assert the piece still locks on
     schedule, not 7.75 seconds later (*the stall bound, corrected 2026-08-13 — see*
     Gravity and lock).
  2. **Move into a wall** — hold left against the well edge on a resting piece and assert
     the same. This is the common one and it is the one to write first.
  3. **A rotation whose every kick fails** — a piece boxed so that no SRS offset resolves,
     asserting the refused rotation resets nothing.
  - Each is paired with its positive control: **the same input in open space DOES reset**.
    Without the pairing, an engine that never resets the lock delay passes all three.
- **The scoring boundary case is asserted by name:** a lock that clears lines *and* crosses
  a level threshold scores at the old level and then levels up. That single ordering is the
  most likely place for the client and the verifier to disagree, and it is one line of test.
- **Zero third-party network requests, verified in the network tab** — the runtime
  measurement over CDP, not a grep for hostnames in the HTML.
  - **The control is not optional.** The same probe, in the same run, must still find the
    third-party hosts on `/games/grains`, `/games/catch` and `/`. A probe that reports clean
    everywhere is measuring nothing.
  - Self-hosted assets under `public/tetrice/` within budget (500 KB total, 300 KB per
    file), and sound under the same rule at `public/sfx/tetrice-*.wav`.
- **The trademarked name appears nowhere in the repo.** `test/tetrice-naming.test.ts` scans
  source, copy, metadata and asset filenames for it. **It carries a positive control** — the
  same matcher, run against a fixture string that does contain the word, must find it —
  because a naming test that always passes is the easiest test in this repo to write by
  accident and the most expensive one to trust wrongly.
  - **The mood board is not in the repo, in any crop.** *Added 2026-08-12 (*What this is*).*
    This one is a **review check, not a test** — a grep cannot see a wordmark inside a PNG,
    and pretending otherwise would be a check that measures nothing. What is testable and
    is asserted: `public/tetrice/` contains no image the size budget did not account for,
    which is where a pasted-in mock would show up.
- Zero new npm dependencies.
- Fully playable keyboard-only and touch-only. **Genuinely playable one-thumbed in
  portrait** — at level 12, not at level 1.
- No hardcoded path prefixes anywhere, TS or CSS.
- Pure-logic modules unit tested under the existing DOM-free vitest setup.
- **`/games/tetrice` is in `PLAY_SURFACE_ROUTES` and `test/play-surfaces.test.ts` covers it
  by name**, in both directions.
- **ALL SEVEN SHAPES SATISFY THE FUSED READ AT 15 px AND AT 30 px.** *Added 2026-08-13; this
  is how the anisotropic-fusion constraint in* The pieces *is accepted.* Re-run
  `/dev/tetrice-gate` after the Phase 3 mechanism lands and check the fused-edge panel at
  both sizes: no shape may read as separated bars or strands because of the angle its grains
  were assigned. Three of seven passed at Phase 1, which is the baseline this is measured
  against — the same panel, the same two cell sizes.
- **`test/tetrice-palette.test.ts` passes, AND FAILS ON ITS POSITIVE CONTROL.** *Added
  2026-08-13.* It parses the seven chromatic tokens out of `globals.css`, computes Rec.709
  luminance, and asserts that **no two shapes whose value bands overlap share a grain axis**
  — the threshold derived from `VALUE_SPREAD`, not hard-coded (*The pieces*). The control is
  a deliberately colliding fake palette the checker must reject; without it, a checker that
  stopped checking would look exactly like a palette that is fine.
- **THE ON-PHONE GATE IS STILL OPEN, AND THE PHASE 1 PASS DID NOT DISCHARGE IT.** *Added
  2026-08-13, as its own line rather than a parenthetical, because a satisfied criterion
  with a caveat inside it reads as satisfied.* The axis code was judged on rendered pixels
  at 45 device px per cell (DPR-3 viewport, 390×844 CSS px). What remains unmeasured is an
  eye at arm's length: real phone, real brightness, off-axis viewing, S versus Z in
  greyscale at the 15 px floor.
- **The palette gate has been run on a phone**, at the real cell size, with all seven shapes
  on screen, including a greyscale pass (*The pieces*).
  - *Added 2026-08-12:* the gate runs against a renderer that **already has the grain
    long-axis channel**, and its job is to falsify the assumption that hue alone would not
    have carried identity — not to discover the collision. A gate run on a hue-only
    renderer is measuring a version this spec has already rejected.
  - The queue is gated at its own cell size (~1.4× the well's), because that is the surface
    where the collision shows first.
- RICE CHOMP, GRAINSNAKE, the grains game and the WS process are untouched and still
  working. `chomp.db`, `grains.db` and `grainsnake.db` are not opened by anything in this
  feature.
