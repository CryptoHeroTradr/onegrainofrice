# onegrainofrice — working constraints

## Repo-wide

- **Never run `pnpm build` directly. Only `deploy/build.sh`.** `next build` mutates
  tracked `tsconfig.json` (it manages the `include` list for `<distDir>/types`), and a
  direct call with a `NEXT_DIST_DIR` outside the repo bakes that absolute path in and
  leaves a stray `tmp/` tree in the repo root. It fails silently — the build succeeds
  and the site is fine. Recovery is `git checkout tsconfig.json && rm -rf tmp/`.
  `build.sh` snapshots and restores `tsconfig.json` on exit, so a build leaves the tree
  byte-identical. Full note: `deploy/README.md`.
- **Promotion is `deploy/promote.sh <build-id>`**, where the id is the git short sha
  `build.sh` printed. **Rollback is the same command with an earlier id** — previous
  builds are kept, never deleted. Record the rollback target sha in the commit body.
- **The git remote uses the SSH host alias `github-onegrainofrice`**
  (`git@github-onegrainofrice:CryptoHeroTradr/onegrainofrice.git`). It is an alias from
  `~/.ssh/config`, not a real hostname. Do not rewrite it to `github.com` — that breaks
  auth.
- **Tailwind v4** (`tailwindcss: ^4`, `@tailwindcss/postcss: ^4`).

## TETRICE

Standing constraints for the Tetrice game. Build, promote, remote and Tailwind are
repo-wide — see above; nothing about Tetrice changes them.

- **Zero third-party runtime requests on the play surface.** No fonts, no analytics, no
  CDN assets. Everything self-hosted. This is the same acceptance criterion `/games/chomp`
  and `/games/grainsnake` hold, and the reason translation is scoped off both.
- **Its own database and its own API namespace.** `data/tetrice.db` and `/api/tetrice/*`.
  It shares nothing with chomp, grains or grainsnake at the data layer. Follow the
  existing per-game shape in `src/lib/chomp/env.ts` and `src/lib/grainsnake/env.ts`:
  default to `path.join(process.cwd(), "data", "tetrice.db")`, allow a `TETRICE_DB_PATH`
  override, and gate the default file behind a `TETRICE_DB_OWNER` single-writer flag.
  Shipping the leaderboard means adding `TETRICE_DB_OWNER` in **two** places — the env
  block in `ecosystem.config.js`, and the preflight loop in `deploy/promote.sh`, which
  today checks only `CHOMP_DB_OWNER` and `GRAINSNAKE_DB_OWNER`. A plain `pm2 restart`
  does not re-read `ecosystem.config.js`, so without it every `/api/tetrice/*` request
  500s until `pm2 restart ecosystem.config.js --only onegrainofrice --update-env`.
- **Pure text helpers ARE shared. Do not duplicate them.** Reuse `checkName`,
  `sanitizeChompName` and `containsProfanity` from **`src/lib/chomp/score.ts`** (which
  also exports `NAME_MIN_LEN` / `NAME_MAX_LEN` and the `NameCheck` type). They live under
  `chomp/` for historical reasons and are pure string functions — reusing them is not a
  data-layer dependency on chomp.
- **Decide the new route's ambient-decoration status in `src/lib/playSurfaces.ts`.** The
  exports are `PLAY_SURFACE_ROUTES` and `isPlaySurface`. *Corrected 2026-08-12: this line
  read "there is no `UNLISTED_PLAY_SURFACES`", which was true of this file and false of the
  repo.* There is no unlisted array **in `playSurfaces.ts`** — `UNLISTED_PLAY_SURFACES` is a
  local const inside `test/play-surfaces.test.ts` (added 2026-08-07, when GRAINSNAKE was
  promoted before its card shipped). It is the allowlist for a play surface that is
  deliberately not a listed game, and **a play-surface route that is not in
  `src/config/games.ts` must be named there or the suite fails.** So a non-game play
  surface is a two-file change: the route in `playSurfaces.ts`, the reason in the test.
  Listing a route turns the site-wide decoration (Translate,
  KonamiRice, RiceParticles, the chopstick cursor) **off** on it; omitting it leaves the
  decoration on. Tetrice almost certainly belongs on the list — the Konami listener eats
  the arrow keys that are its primary control, and the translate script would break the
  zero-third-party-request rule above. The list is deliberately not "the games"
  (`/games/catch` and `/games/grains` are off it on purpose), so state the reason, and
  read the header comment before editing. The match is exact, so renaming the route
  without renaming it here fails silently; `test/play-surfaces.test.ts` asserts every
  entry is a route that exists on disk.
- **Naming: the game is TETRICE.** Do not use the word "Tetris" anywhere — code, copy,
  metadata, alt text, filenames, or commit messages — and do not copy the official logo,
  wordmark, or colour scheme. The reference mock reads "TETRIS RICE EDITION"; the shipped
  panel reads **"TETRICE / ONE GRAIN OF RICE"**. Piece letters (I, J, L, S, Z, T, O) are
  fine; call them "pieces" or "shapes", never the trademarked term.
