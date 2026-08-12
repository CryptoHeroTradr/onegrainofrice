#!/usr/bin/env bash
#
# onegrainofrice — DEV SERVER (safe: never writes ./.next, never dirties tsconfig.json).
#
# `next dev` has the same two side effects `next build` has, and until 2026-08-13 only the
# build path was protected. Both are documented in deploy/README.md; this script is the
# other half of that protection.
#
#   1. IT WRITES TO ./.next BY DEFAULT — which, since the build/promote split, is a SYMLINK
#      into builds/<sha>: the directory the live process is serving. A dev server left
#      running for days holds files open inside a live build directory, and the failure that
#      sets up arrives during a promote, when that directory is swapped or removed under it.
#      Nothing looks wrong until the worst possible moment. So this script forces
#      NEXT_DIST_DIR to builds/_dev and refuses to start without it.
#
#   2. IT MUTATES TRACKED tsconfig.json — it manages the "include" list for <distDir>/types,
#      so pointing distDir anywhere but the default rewrites a tracked file and leaves the
#      tree dirty. Snapshot and restore on exit, exactly as build.sh does.
#
# Scope: this touches builds/_dev ONLY. It does not restart pm2, does not touch server/ or
# the oneg-grains-ws (:3007) process, and does not touch RiceDAO.
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root

PORT="${1:-${PORT:-3005}}"
# builds/ rather than a new .next-dev: it is ALREADY gitignored and ALREADY excluded in
# tsconfig.json, so this reuses two existing exclusions instead of adding two more places
# to forget. Underscore-prefixed so it never collides with a git-short-sha build dir.
OUT="builds/_dev"

echo "=== onegrainofrice · dev ==="
echo "port:         $PORT"
echo "distDir:      $OUT   (NOT ./.next — that is the live build)"
echo "live ./.next: $(readlink .next 2>/dev/null || echo '(not a symlink)') — untouched"
echo

if [ ! -f .env.local ]; then
  echo "!! .env.local is missing — basePath/RPC would run wrong. Aborting." >&2
  exit 1
fi

# A dev server already on this port is almost always one somebody forgot. Say so by name
# rather than letting Next silently pick 3006 — which is the LIVE port.
if command -v ss >/dev/null 2>&1 && ss -lptn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
  echo "!! Port $PORT is already listening. Another dev server is probably still running:" >&2
  ss -lptn "sport = :$PORT" 2>/dev/null | sed 's/^/   /' >&2
  echo "   Stop it first (kill it by its listening socket, never by pkill -f)." >&2
  exit 1
fi

# `next dev` MUTATES tracked tsconfig.json. Snapshot it and restore on exit — success,
# failure, or Ctrl-C — so a dev session leaves the repo byte-identical. Same trap as
# build.sh, and for the same reason.
TSCONFIG_BAK="$(mktemp)"
cp tsconfig.json "$TSCONFIG_BAK"

# ─── ONE CLEANUP FUNCTION, ONE TRAP. APPEND HERE; DO NOT ADD A SECOND TRAP. ──────────
#
# `trap ... EXIT` REPLACES any existing EXIT trap rather than adding to it, so a second
# one anywhere below silently disables everything in here — including the tsconfig
# restore, which is the whole reason this script has a trap. build.sh carries the same
# structure for the same reason, after a second trap was nearly added to it.
#
# Everything that must run on exit goes INSIDE cleanup(); TMPFILES is where a temp file
# gets registered. The rule is carried by the shape of the code, not by this comment —
# a comment only helps someone who reads it before writing their own trap.
TMPFILES=("$TSCONFIG_BAK")
cleanup() {
  if [ -f "$TSCONFIG_BAK" ]; then
    cp "$TSCONFIG_BAK" tsconfig.json
    echo
    echo "=== tsconfig.json restored ==="
  fi
  rm -f "${TMPFILES[@]}"
}
trap cleanup EXIT INT TERM

mkdir -p builds
# ─── DO NOT ADD `exec` HERE. ─────────────────────────────────────────────────────────
# `exec` in front of a long-running process is the obvious tidy-up for a wrapper script —
# one fewer process, signals go straight through — and it is wrong in THIS script, for a
# reason nothing at this line would otherwise show you:
#
#   exec REPLACES this shell, and the EXIT trap set above goes with it. tsconfig.json is
#   then never restored, so every dev session ends with a tracked file rewritten to point
#   at builds/_dev — the exact damage this script exists to prevent, reintroduced by a
#   change that looks like a cleanup and breaks nothing visible.
#
# Nothing fails loudly if you do it. The build keeps working, dev keeps working, and the
# tree is dirty in a way that gets committed by someone who did not cause it. Run Next as
# a CHILD and let the trap fire on exit, failure, or Ctrl-C.
# -H 127.0.0.1 is NOT optional and NOT only about exposure. Next 16 blocks its own dev
# resources for requests whose host is not in `allowedDevOrigins` (default: localhost), so
# a server bound to 0.0.0.0 and reached as http://127.0.0.1:PORT serves HTML that never
# HYDRATES — no error, no console message, just a page that renders the server output and
# then does nothing. That cost an hour once; binding loopback is also what a dev server on
# a public VPS should do anyway.
NEXT_DIST_DIR="$OUT" node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p "$PORT"
