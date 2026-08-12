# Deploying $RICE on the VPS at `209.141.52.60/onegrainofrice`

The app is mounted under **basePath `/onegrainofrice`** and runs on **port 3006**
behind the shared nginx gateway (the `ip-rice` default server for `:80`), next
to CXMZ (`/CXMZ/`) and RiceDAO (`/RiceDAO/`).

> **Grains game (GeoIP2 + WebSocket + pm2):** the production edge for the rice
> clicker at `/onegrainofrice/grains` — GeoIP2 country headers, the WS proxy to
> `:3007`, geoipupdate, and the finalized pm2 ecosystem — is documented in
> **[docs/grains/DEPLOY.md](../docs/grains/DEPLOY.md)**. The nginx block below is
> superseded by [nginx-onegrainofrice.location](nginx-onegrainofrice.location)
> (app + WS) once that runbook is applied.

## App process (pm2) — already running

Registered with pm2 as `onegrainofrice`, matching the other apps:

```bash
pm2 start pnpm --name onegrainofrice --cwd /home/deploy/onegrainofrice -- start
pm2 save
```

Useful ops: `pm2 restart onegrainofrice` · `pm2 logs onegrainofrice` · `pm2 stop onegrainofrice`.

## Deploying new code — build and deploy are SEPARATE

> The old `pnpm build && pm2 restart` built **in place**: `next build` overwrote
> the same `./.next` the live process was serving, so for a few minutes the
> running site referenced chunks that no longer existed on disk (stale-chunk
> 404s). Building was, in effect, deploying. **That flow is retired.** Use the
> two scripts below.

**1. Build (safe — never touches the live site):**

```bash
deploy/build.sh
```

Writes a complete, self-consistent build to `builds/<git-short-sha>/` via
`NEXT_DIST_DIR` (see `next.config.ts`). It never writes `./.next`, never restarts
pm2, and never touches `oneg-grains-ws` (:3007). Run it as often as you like,
including while the site is live. It verifies the build (`BUILD_ID`, manifests,
static chunks) and prints the promote command.

> **NEVER call `pnpm build` directly — always `deploy/build.sh`.** *Added
> 2026-08-07, after doing exactly that.* `next build` **mutates tracked
> `tsconfig.json`**: it manages the `include` list for `<distDir>/types`, so a
> direct call with a `NEXT_DIST_DIR` outside the repo bakes that **absolute path**
> into `tsconfig.json` and leaves the tree dirty. It also reformats the whole file
> (every array expanded one-entry-per-line), so the diff is large and the one line
> that matters is buried in it, and an absolute dist dir additionally leaves a
> stray `tmp/` tree in the repo root.
>
> `build.sh` snapshots `tsconfig.json` before the build and restores it on exit —
> success **or** failure — so a build leaves the repo byte-identical. That trap is
> the whole reason the snapshot exists.
>
> **This fails silently**, which is why it is written down: nothing errors, the
> build succeeds, the site is fine, and the damage is a committed `tsconfig.json`
> pointing at a path that exists on exactly one machine. Recover with
> `git checkout tsconfig.json && rm -rf tmp/`.
>
> **`next dev` DOES BOTH OF THESE TOO, AND THIS NOTE COVERED ONLY HALF THE
> COMMANDS UNTIL NOW.** *Amended 2026-08-13, after finding a `next dev` that had
> been running for six days writing through the `./.next` symlink into the live
> build directory.* Dev mutates `tsconfig.json` by the same mechanism — it manages
> the same `include` list — and it writes to `./.next` by default, which since the
> build/promote split is a **symlink into `builds/<sha>`**: the directory the live
> process is serving. Nothing is damaged on the day it happens. The failure it
> sets up is a build directory being swapped or removed **during a promote** with
> a dev server still holding files open inside it, which is the worst possible
> moment to discover it. Use **`deploy/dev.sh`** (below), never a bare `next dev`.

**Local dev (safe — never writes `./.next`, never dirties the tree):**

```bash
deploy/dev.sh          # port 3005 by default
deploy/dev.sh 3099     # or pass one
```

*Added 2026-08-13.* Forces `NEXT_DIST_DIR=builds/_dev`, so the live `./.next`
symlink is untouched; snapshots and restores `tsconfig.json` on exit — success,
failure **or Ctrl-C** — using the same trap `build.sh` uses; and refuses to start
if the port is already listening, because Next's fallback behaviour is to pick
the next port up, and the next port up from 3005 is **3006, the live one**.
`pnpm dev` runs this script, so the protection is not something to remember.

`builds/_dev` rather than a new `.next-dev`: `builds/` is already gitignored and
already excluded in `tsconfig.json`, so this reuses two exclusions instead of
adding two more places to forget one.

> **THE COMPLETENESS CHECK RUNS WHERE THE DATA IS FRESH. THE MANIFEST IS HOW IT
> TRAVELS TO WHERE THE DATA IS TRUSTED.** *Added 2026-08-13.* The check above
> runs on the directory `build.sh` just produced. It proves the build was whole
> when it was made and says nothing about that directory weeks later, when
> `promote.sh` is asked to roll back to it — and `promote.sh`'s only test used to
> be "the directory exists and has a `BUILD_ID`". A build that was complete at
> build time and had since been truncated, half-deleted, cut short by a full disk
> or badly rsynced **promoted in silence**.
>
> `build.sh` now writes `BUILD_MANIFEST` as its **last** step, after the
> completeness check passes. Written any earlier it would faithfully describe an
> incomplete build, which is worse than no manifest at all: it would make a broken
> directory verifiable.
>
> **What it records, and what it deliberately does not.** Path, size and file
> count for every file, plus a sha256 of exactly three: `BUILD_ID`,
> `build-manifest.json`, `prerender-manifest.json` — the three whose *contents*
> gate correctness. It does **not** hash the tree. Truncation, half-deletion,
> out-of-disk and bad rsync all either remove a file or change its size, so path +
> size catches every failure mode on the list; hashing ~840 files would buy
> detection of silent bit-rot that has never been observed here and charge for it
> on every promote.
>
> **Missing or wrong-sized files refuse. Extra files only warn.** Nothing this
> guards against *adds* files, and extra files turn up for benign reasons — a
> stray dev server wrote into a live build directory once, which is part of why
> this exists. Refusing on those would make the guard the outage.

**Verifying a rollback target without promoting it:**

```bash
deploy/promote.sh --verify <id>     # checks the manifest, changes nothing
```

Runs the identical check the real promote runs and stops before the symlink. Use
it to ask "is that rollback target still intact?" while nothing is on fire, which
is the only calm moment to find out.

**Migration: `no manifest` has to mean two different things.**

Every build made before 2026-08-13 — 56 of them, including the one currently live
— has no manifest. So the absent case cannot simply refuse, or this change would
make every existing rollback target unusable in the name of protecting it.

`build.sh` therefore writes **`MANIFEST=1` into the `BUILT` file** of every build
it produces from now on, and `promote.sh` reads *that* to tell the two apart:

| `BUILT` | `BUILD_MANIFEST` | promote.sh |
|---|---|---|
| **absent** | anything | **REFUSES** — a missing `BUILT` is damage, not age |
| present, no `MANIFEST=1` | absent | **WARNS LOUDLY and proceeds** — grandfathered |
| present, `MANIFEST=1` | absent, empty, or truncated | **REFUSES** — fail closed |
| present | present | **VERIFIES IT** |

> **A MISSING `BUILT` REFUSES.** *Tightened 2026-08-13.* Grandfathering on its absence
> was the last fail-open: a build that lost both its manifest and its `BUILT` would
> have promoted unverified behind a banner nobody reads at 3am.
>
> **This required a one-time backfill, because the premise was not true when it was
> written.** Twelve of the fifty-eight build directories had no `BUILT` — the hand-named
> phase builds (`phase3`, `phase4`, `p56`, `p56b`, `p56c`, `phase6e`, `d0c1485-p5`,
> `d0c1485-p5b`, `2217c0c-p5c`, `af580a5`, `a102535`) **and
> `premigrate-1784998263201`, which is the rollback floor `promote.sh` itself creates on
> the first promote.** Refusing on a missing `BUILT` without backfilling would have
> bricked the deepest rollback target on the box in the name of protecting it. Each was
> given a `BUILT` recording exactly what is known — provenance backfilled, commit
> unknown, and deliberately **no** `MANIFEST` line, so they still take the grandfathered
> path. `builds/_dev` was left alone: it is a dev `distDir`, not a promote target, and it
> *should* be refused.
>
> **The way past, if it ever fires on a build you know is good, is a declaration rather
> than a flag** — the refusal prints a one-line `printf … > builds/<id>/BUILT` that
> re-declares it. That is deliberate (it cannot be typed reflexively as a command prefix),
> it leaves a record on disk, and it keeps this guard off the critical path out of an
> incident, which is the standing rule a hard stop here would otherwise break.

**Three ways a directory can be unverifiable, and they are three different claims.**
*Added 2026-08-13.* A `BUILT` written at 2am under pressure used to look identical on disk
to one reconstructed carefully in daylight. It does not any more, and `promote.sh` names
which it is looking at in the banner — the moment somebody actually needs to know:

| Marker in `BUILT` | Banner says | What it means |
|---|---|---|
| *(none — `BUILT_FROM_COMMIT` only)* | `PRE-MANIFEST` | Written at build time by an older `build.sh`, before manifests existed. Provenance is real; there is simply nothing to check the contents against. **Strongest of the three.** |
| `BACKFILLED_AT=<date>` | `BACKFILLED on <date>` | Provenance reconstructed after the fact, in daylight, for a directory that never had a `BUILT`. The twelve listed above. Contents have never been checked. |
| `DECLARED_AT=<date>` | `DECLARED BY HAND on <date>` | An operator hit the missing-`BUILT` refusal and vouched for the directory — by definition under pressure. **No build-time provenance at all.** Weakest of the three, and the one worth a second look afterwards. |

Nothing in `promote.sh` treats them differently — all three take the grandfathered path and
promote. The distinction is for the human reading the banner, and for whoever asks later
how a given directory came to be trusted.

> *Rejected: letting the manifest's own absence mean "old build".* It is the
> obvious design and it is precisely the fail-open this check exists to prevent —
> a deleted manifest would look identical to a build that never had one, so the
> damage would disable the guard that detects it.
>
> *Rejected: comparing dates or directory mtimes.* An mtime says when something
> last touched the directory, not when it was built, and the dev-server incident
> is a standing example of something touching one for unrelated reasons.
>
> *Rejected: a version field inside the manifest.* It answers the wrong question.
> It can distinguish an old format from a new one; it cannot say anything at all
> when the file is not there, which is the case that matters.
>
> **The known residual, stated rather than discovered:** if a build loses *both*
> its manifest and its `BUILT` marker, it falls back to the grandfathered path and
> promotes unverified. That takes two specific files disappearing, and the loud
> `UNVERIFIED BUILD` banner still fires on the way past — which is the mitigation.
> This is a guard against truncation and bad copies, not against an adversary.

A grandfathered promote prints, before anything is switched:

```
  !! UNVERIFIED BUILD — builds/7d937fa has no manifest.
     It predates manifest-writing builds (no MANIFEST=1 in its BUILT), so this
     promote is allowed and its contents CANNOT be checked against what was built.
```

**2. Promote (a separate, deliberate act — you run it, watching):**

```bash
deploy/promote.sh <sha>     # the sha build.sh just printed
```

Repoints `./.next -> builds/<sha>` and `pm2 restart onegrainofrice`. Because each
build is internally consistent there is **no stale-chunk 404 window** — the only
gap is the ~1s restart 502. It stamps a `DEPLOYED` marker (deployed id, repo HEAD,
dirty-file count, timestamp) and prints it, so a deploy can always say what it
shipped. The **first** promote migrates `./.next` from a real directory to a
symlink, preserving the current live build as `builds/premigrate-<old-build-id>`
so there is a rollback floor.

**Rollback (the previous build is kept, never deleted):**

```bash
deploy/promote.sh --verify <previous-sha>    # step 0 — is the target still intact?
deploy/promote.sh <previous-sha>             # the rollback itself
```

**Step 0 is not optional ceremony, and it is the step that will be skipped.** The promote
runs the same check and refuses on the same evidence, so nothing is lost by going
straight to the second line — but you will find out *during* the incident rather than
before it, and if the target is damaged you will be choosing your next move under
pressure with one fewer option than you thought you had. Run `--verify` on the current
rollback target when nothing is wrong; that is the only calm moment there is.

`builds/` is git-ignored (build artifacts, like `.next`). Prune old builds
manually when disk warrants; never delete the build `./.next` currently points at
or its immediate predecessor.

> Note: nginx fronts the live site at **1grainofrice.com** (`location / ->
> 127.0.0.1:3006`, `NEXT_PUBLIC_BASE_PATH=""`, app served at root). The
> `/onegrainofrice`-prefix section below is the older shared-IP gateway and is
> not the live path.

## nginx route — needs root (run these once)

Adds a `location ^~ /onegrainofrice` proxy to `127.0.0.1:3006`. The block lives
in [nginx-onegrainofrice.location](nginx-onegrainofrice.location); the command
inserts it into the existing `ip-rice` server block (right after `server_name`),
backs the file up first, validates, then reloads:

```bash
sudo cp /etc/nginx/sites-available/ip-rice /etc/nginx/sites-available/ip-rice.bak.$(date +%s)
sudo sed -i '/server_name 209.141.52.60 _;/r /home/deploy/onegrainofrice/deploy/nginx-onegrainofrice.location' /etc/nginx/sites-available/ip-rice
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` must print `syntax is ok` / `test is successful` before the reload
runs (the `&&` guards it). If it fails, restore the backup:
`sudo cp /etc/nginx/sites-available/ip-rice.bak.* /etc/nginx/sites-available/ip-rice`.

## Verify

```bash
# app directly (should already work)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3006/onegrainofrice   # 200

# through nginx after the reload
curl -s -o /dev/null -w '%{http_code}\n' http://209.141.52.60/onegrainofrice     # 200
```

Then open **http://209.141.52.60/onegrainofrice** in a browser.

## Why basePath + no collisions

nginx already routes root-level `/_next/` to CXMZ and `/memes/` to RiceDAO. This
app namespaces everything under `/onegrainofrice/…` (via `basePath` and the
`asset()` helper on image `src`), and nginx prefix-matching sends the longer
`/onegrainofrice` prefix here — so `/onegrainofrice/_next/…` and
`/onegrainofrice/memes/…` never fall through to the other apps.
