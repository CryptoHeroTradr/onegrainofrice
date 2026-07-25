#!/usr/bin/env bash
#
# onegrainofrice — BUILD (safe, repeatable, never touches the live site).
#
# Produces a complete, self-consistent build in builds/<git-short-sha>/ and stops.
# It NEVER writes ./.next — the directory the live `next start` process serves —
# because NEXT_DIST_DIR redirects Next's output to builds/<sha> (see next.config.ts).
# Promotion to live is a separate, deliberate act: deploy/promote.sh.
#
# Scope: this touches builds/ ONLY. It does not restart pm2, does not touch
# server/ or the oneg-grains-ws (:3007) process, and does not touch RiceDAO.
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root
ROOT="$(pwd)"

SHA="$(git rev-parse --short HEAD)"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
OUT="builds/$SHA"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "=== onegrainofrice · build ==="
echo "commit:       $SHA"
echo "dirty files:  $DIRTY   (record-and-print; a dirty tree is allowed)"
echo "output:       $ROOT/$OUT"
echo "live ./.next: NOT written by this build"
echo

if [ ! -f .env.local ]; then
  echo "!! .env.local is missing — basePath/RPC would build wrong. Aborting." >&2
  exit 1
fi

# GUARD: never build the directory the live site is serving. If HEAD's sha equals
# what ./.next points at, the rm+rebuild below would DESTROY the running build
# (a dirty tree at the live sha is the usual way to hit this). Commit first so HEAD
# advances to a new sha, then build — the new build lands beside the live one and
# promote.sh swaps atomically.
LIVE_LINK="$(readlink .next 2>/dev/null || true)"
if [ -n "$LIVE_LINK" ] && [ "$OUT" = "$LIVE_LINK" ]; then
  echo "!! REFUSING: builds/$SHA is the CURRENTLY-LIVE build (./.next -> $LIVE_LINK)." >&2
  echo "   Building it would overwrite the running site. Commit your changes so HEAD" >&2
  echo "   advances to a new sha, then re-run. (dirty files: $DIRTY)" >&2
  exit 1
fi

mkdir -p builds
rm -rf "$OUT"

# `next build` MUTATES tracked tsconfig.json — it manages the "include" list for
# <distDir>/types, so with distDir=builds/<sha> it would bake a per-sha path in
# and leave the tree dirty after every build. Snapshot it and restore on exit
# (success or failure) so a build leaves the repo byte-identical.
TSCONFIG_BAK="$(mktemp)"
cp tsconfig.json "$TSCONFIG_BAK"
restore_tsconfig() { [ -f "$TSCONFIG_BAK" ] && cp "$TSCONFIG_BAK" tsconfig.json && rm -f "$TSCONFIG_BAK"; }
trap restore_tsconfig EXIT

# distDir -> builds/<sha> via the NEXT_DIST_DIR hook in next.config.ts.
# BUILD_ID stamped to the sha so generateBuildId + asset() versioning match the commit.
echo "=== next build (distDir=$OUT, BUILD_ID=$SHA) ==="
NEXT_DIST_DIR="$OUT" BUILD_ID="$SHA" pnpm build

echo
echo "=== verify completeness (a build only counts if these all exist) ==="
fail=0
need() { if [ ! -e "$OUT/$1" ]; then echo "  MISSING  $1"; fail=1; else echo "  ok       $1"; fi; }
need BUILD_ID
need build-manifest.json
need prerender-manifest.json
need server
need static
if ls "$OUT"/static/chunks/*.js >/dev/null 2>&1; then echo "  ok       static/chunks/*.js"; else echo "  MISSING  static/chunks/*.js"; fail=1; fi
if [ -f "$OUT/BUILD_ID" ]; then
  got="$(cat "$OUT/BUILD_ID")"
  if [ "$got" = "$SHA" ]; then echo "  ok       BUILD_ID == $SHA"; else echo "  MISMATCH BUILD_ID=$got != $SHA"; fail=1; fi
fi
if [ "$fail" != 0 ]; then echo; echo "BUILD INCOMPLETE — do not promote $OUT" >&2; exit 1; fi

# Provenance marker written at build time (what commit/dirty this build came from).
{
  echo "BUILT_FROM_COMMIT=$SHA"
  echo "BUILT_DIRTY_FILES=$DIRTY"
  echo "BUILT_AT=$STAMP"
} > "$OUT/BUILT"

echo
echo "=== build OK: $OUT (commit $SHA, $DIRTY dirty) — NOT live ==="
echo
echo "Promote it (a separate, deliberate act — run while watching):"
echo "    deploy/promote.sh $SHA"
