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

# ─── ONE CLEANUP FUNCTION, ONE TRAP. APPEND HERE; DO NOT ADD A SECOND TRAP. ──────────
#
# `trap ... EXIT` REPLACES any existing EXIT trap rather than adding to it, so a second
# one anywhere below silently disables everything in here — including the tsconfig
# restore, which is the whole reason this script has a trap at all. That is not a
# hypothetical: it was written once, in this file, while adding the manifest step, and
# it would have traded a stray temp file for the dirty tracked file the snapshot exists
# to prevent.
#
# The comment on its own only helps someone who reads it BEFORE writing their trap, which
# is not how it happened. So the structure carries the rule: everything that must run on
# exit goes INSIDE cleanup(), and TMPFILES is the place to register a temp file.
TMPFILES=("$TSCONFIG_BAK")
cleanup() {
  if [ -f "$TSCONFIG_BAK" ]; then
    cp "$TSCONFIG_BAK" tsconfig.json
  fi
  rm -f "${TMPFILES[@]}"
}
trap cleanup EXIT INT TERM

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
#
# `MANIFEST=1` is the MIGRATION DISCRIMINATOR, and it is here rather than in the manifest
# because the manifest cannot testify to its own absence. promote.sh reads this line to
# tell "this build was made before manifests existed" (warn, proceed) from "this build
# should have a manifest and does not" (refuse). See deploy/README.md.
{
  echo "BUILT_FROM_COMMIT=$SHA"
  echo "BUILT_DIRTY_FILES=$DIRTY"
  echo "BUILT_AT=$STAMP"
  echo "MANIFEST=1"
} > "$OUT/BUILT"

# --- the manifest, written LAST -------------------------------------------------
#
# *Added 2026-08-13.* The completeness check above runs on the directory this script just
# produced — it proves the build was whole when it was made, and says nothing about the
# directory weeks later, when promote.sh is asked to roll back to it. A build that was
# complete at build time and has since been truncated, half-deleted, cut short by a full
# disk or badly rsynced used to promote in silence, because promote.sh's only test was
# "the directory exists and has a BUILD_ID".
#
# WHAT IS RECORDED AND WHY IT IS NOT A CHECKSUM OF THE TREE. Every one of those failures
# either removes a file or changes its size, so path + size + count catches all of them.
# Hashing ~2,000 files would buy detection of silent bit-rot that has never been observed
# here, and would charge for it on every promote. Checksums are spent on exactly the three
# files whose CONTENTS gate correctness: BUILD_ID, build-manifest.json,
# prerender-manifest.json.
#
# WRITTEN LAST, AFTER THE COMPLETENESS CHECK ABOVE HAS PASSED. A manifest written any
# earlier would faithfully describe an incomplete build, which is worse than no manifest:
# it would make a broken directory verifiable.
MANIFEST="$OUT/BUILD_MANIFEST"
BUILD_LIST="$(mktemp)"
TMPFILES+=("$BUILD_LIST")   # registered with cleanup() above — never a second trap
( cd "$OUT" && find . -type f -printf '%P\t%s\n' ) | LC_ALL=C sort > "$BUILD_LIST"

# The format is tab-separated, so a path containing a tab would make it ambiguous to
# parse. Refuse HERE, where it is cheap and loud, rather than mis-verifying later.
if ! LC_ALL=C awk -F'\t' 'NF != 2 { exit 1 }' "$BUILD_LIST"; then
  echo "!! a build path contains a tab — the manifest format cannot represent it." >&2
  LC_ALL=C awk -F'\t' 'NF != 2 { print "   " $0 }' "$BUILD_LIST" >&2
  exit 1
fi

{
  echo "MANIFEST_VERSION=1"
  echo "BUILT_FROM_COMMIT=$SHA"
  echo "BUILT_AT=$STAMP"
  printf 'FILE_COUNT=%s\n' "$(wc -l < "$BUILD_LIST" | tr -d ' ')"
  for f in BUILD_ID build-manifest.json prerender-manifest.json; do
    printf 'SHA256\t%s\t%s\n' "$f" "$(sha256sum "$OUT/$f" | cut -d' ' -f1)"
  done
  LC_ALL=C awk -F'\t' '{ printf "SIZE\t%s\t%s\n", $2, $1 }' "$BUILD_LIST"
  # The terminator is how a TRUNCATED manifest is detected. Without it, a manifest cut
  # short mid-write describes a subset of the build and verifies clean against it.
  echo "END_MANIFEST"
} > "$MANIFEST"

echo "  manifest: $(wc -l < "$BUILD_LIST" | tr -d ' ') files recorded in $OUT/BUILD_MANIFEST"

echo
echo "=== build OK: $OUT (commit $SHA, $DIRTY dirty) — NOT live ==="
echo
echo "Promote it (a separate, deliberate act — run while watching):"
echo "    deploy/promote.sh $SHA"
