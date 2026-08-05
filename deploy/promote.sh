#!/usr/bin/env bash
#
# onegrainofrice — PROMOTE (make a build live) / ROLLBACK.
#
# Repoints ./.next at builds/<id> and restarts the WEB process only. Because
# every build in builds/ is internally self-consistent (its HTML, chunks and
# BUILD_ID all match), there is NO stale-chunk 404 window: the sole gap is the
# ~1s pm2 restart 502. That is the entire improvement over building in place.
#
# Scope — touches exactly two things:
#   * the ./.next symlink
#   * `pm2 restart onegrainofrice`
# It NEVER touches server/, the oneg-grains-ws (:3007) process (which shares this
# cwd but reads server/, not .next), or RiceDAO.
#
# Usage:
#   deploy/promote.sh <id>        # id = a build in builds/ (git short sha)
#   deploy/promote.sh <prev-id>   # the SAME command is how you roll back
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root
PM2_APP="onegrainofrice"
ID="${1:-}"

# The live process must serve ./.next (default distDir). Make sure no build-time
# override leaks from the promoting shell into the restarted process — otherwise
# `next start` would read builds/<sha> directly and the symlink model breaks.
unset NEXT_DIST_DIR BUILD_ID NEXT_PUBLIC_BUILD_ID 2>/dev/null || true

if [ -z "$ID" ]; then
  echo "usage: deploy/promote.sh <build-id>" >&2
  echo "available builds: $(ls builds 2>/dev/null | tr '\n' ' ')" >&2
  exit 1
fi

TARGET="builds/$ID"
if [ ! -d "$TARGET" ] || [ ! -f "$TARGET/BUILD_ID" ]; then
  echo "!! $TARGET is missing or incomplete. Build first: deploy/build.sh" >&2
  exit 1
fi

CURRENT_LINK="$(readlink .next 2>/dev/null || true)"   # empty if .next is a real dir
echo "=== onegrainofrice · promote ==="
echo "target:   $TARGET   (BUILD_ID $(cat "$TARGET/BUILD_ID"))"
echo "current:  ${CURRENT_LINK:-<./.next is a real directory — first promote>}"
echo

# What to roll back to after THIS promote (printed at the end).
ROLLBACK_ID="${CURRENT_LINK#builds/}"

# --- FIRST-TIME MIGRATION -------------------------------------------------------
# ./.next is a real directory (never promoted before). Preserve the currently-live
# build as a rollback FLOOR, then replace .next with a symlink. This is the one
# moment the served directory changes shape; do it explicitly.
if [ -e .next ] && [ ! -L .next ]; then
  FLOOR="builds/premigrate-$(cat .next/BUILD_ID 2>/dev/null || echo unknown)"
  echo "first promote: ./.next is a real directory."
  echo "  preserving the live build as a rollback floor:  mv .next $FLOOR"
  mkdir -p builds
  mv .next "$FLOOR"
  ROLLBACK_ID="${FLOOR#builds/}"
  echo "  done — rollback floor is  deploy/promote.sh $ROLLBACK_ID"
fi

# --- atomic symlink swap --------------------------------------------------------
echo "  ln -sfn $TARGET .next"
ln -sfn "$TARGET" .next

# --- record-and-print guard: stamp what we are shipping -------------------------
SHA="$(git rev-parse --short HEAD)"
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo "DEPLOYED_ID=$ID"
  echo "DEPLOYED_AT=$STAMP"
  echo "REPO_HEAD_AT_PROMOTE=$SHA"
  echo "DIRTY_FILES_AT_PROMOTE=$DIRTY"
} > "$TARGET/DEPLOYED"
echo
echo "  DEPLOYED marker: $TARGET/DEPLOYED"
sed 's/^/    /' "$TARGET/DEPLOYED"

# --- restart the WEB process only ----------------------------------------------
echo
echo "  pm2 restart $PM2_APP   (NOT oneg-grains-ws :3007, NOT RiceDAO)"
# No --update-env: keep the process's existing env; .env.local is read by Next
# itself at start. This also guarantees we never inject a stray NEXT_DIST_DIR.
pm2 restart "$PM2_APP"

# --- one-time env preflight: the chomp single-writer flag ----------------------
# `pm2 restart <name>` above deliberately does NOT re-read ecosystem.config.js, so
# an env var ADDED to that file never reaches the running process through a normal
# promote. CHOMP_DB_OWNER is such a var, and without it every /api/chomp/* request
# 500s — src/lib/chomp/env.ts refuses to open the default database for a process
# that has not claimed it.
#
# This WARNS and never refuses. A hard failure here would block a rollback, and a
# guard that can take down production is worse than the hazard it prevents — which
# is the same rule that made the flag a declaration rather than a lockfile.
if ! pm2 jlist 2>/dev/null | grep -q "CHOMP_DB_OWNER"; then
  echo
  echo "  !! WARNING: the running process has no CHOMP_DB_OWNER."
  echo "     Builds carrying the RICE CHOMP leaderboard will answer 500 on"
  echo "     /api/chomp/* until it is injected. This is a ONE-TIME step:"
  echo
  echo "         pm2 restart ecosystem.config.js --only onegrainofrice --update-env"
  echo "         pm2 save"
  echo
  echo "     (Re-reads the config file, unlike the plain restart above. After"
  echo "      pm2 save it persists, so later promotes need nothing.)"
fi

echo
echo "=== promoted $ID · repo HEAD $SHA · $DIRTY dirty ==="
echo "Verify (expect 200 on a hard refresh, no 404 window):"
echo "    curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3006/"
# /home was a 200 page until Phase 7 and is a 308 to / from then on, so it is a bad
# smoke target either way. The games index is a page on both sides of that change.
echo "    curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3006/api/chomp/leaderboard"
if [ -n "$ROLLBACK_ID" ]; then
  echo "Rollback (previous build — kept, never deleted):"
  echo "    deploy/promote.sh $ROLLBACK_ID"
else
  echo "Rollback: no previous build recorded (this was the first promote)."
fi
