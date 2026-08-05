#!/usr/bin/env bash
#
# onegrainofrice — PREVIEW (a production build on :3099, never live).
#
# WHY THIS EXISTS: five instrument failures on this project, two of them a stale
# preview. The failure mode is always the same and is always silent — a `next start`
# left running on :3099 keeps serving a build directory that has since been DELETED,
# because Next holds its file descriptors open. The port answers 200, the page looks
# right, and every number measured off it describes a build that no longer exists.
#
# `lsof -ti:3099` is what missed it, twice: it printed nothing and the kill was a
# no-op. `ss -lptn 'sport = :3099'` found the pid immediately. So this script uses
# ss, and it PRINTS THE BUILD STAMP IT IS ACTUALLY SERVING, read back over HTTP from
# the running server rather than from the variable we passed in.
#
# If a future session cannot say which build it is measuring, none of its numbers
# mean anything.
#
# Usage:
#   deploy/preview.sh <build-id>     # build id under builds/, e.g. phase7b
#   deploy/preview.sh --stop         # stop whatever holds the port
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root
PORT=3099
SCRATCH_DB="${CHOMP_DB_PATH:-/tmp/chomp-preview-$$.db}"

# ── Find and stop whatever holds the port ──────────────────────────────────────
# ss, NOT lsof. See the header. `-p` needs no privileges for our own processes.
port_pids() {
  ss -lptnH "sport = :$PORT" 2>/dev/null |
    grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u
}

stop_port() {
  local pids
  pids="$(port_pids || true)"
  if [ -z "$pids" ]; then
    echo "  port $PORT: free"
    return 0
  fi
  echo "  port $PORT held by pid(s): $(echo "$pids" | tr '\n' ' ')"
  # Kill the whole process group of each holder: `npx next start` is a chain of
  # npm exec -> sh -c -> next-server, and killing only the listener leaves the
  # parents to respawn or to hold the port in TIME_WAIT.
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  for _ in $(seq 1 20); do
    [ -z "$(port_pids || true)" ] && break
    sleep 0.5
  done
  if [ -n "$(port_pids || true)" ]; then
    echo "  still held — escalating to SIGKILL"
    for pid in $(port_pids); do kill -9 "$pid" 2>/dev/null || true; done
    sleep 1
  fi
  echo "  port $PORT: free"
}

if [ "${1:-}" = "--stop" ]; then
  echo "=== preview · stop ==="
  stop_port
  exit 0
fi

ID="${1:-}"
if [ -z "$ID" ]; then
  echo "usage: deploy/preview.sh <build-id>   (available: $(ls builds 2>/dev/null | tr '\n' ' '))" >&2
  echo "       deploy/preview.sh --stop" >&2
  exit 1
fi

TARGET="builds/$ID"
if [ ! -d "$TARGET" ] || [ ! -f "$TARGET/BUILD_ID" ]; then
  echo "!! $TARGET is missing or incomplete (no BUILD_ID). Build it first." >&2
  exit 1
fi
STAMP="$(cat "$TARGET/BUILD_ID")"

echo "=== onegrainofrice · preview ==="
echo "  build dir:    $TARGET"
echo "  BUILD_ID:     $STAMP"
echo "  CHOMP_DB_PATH: $SCRATCH_DB"
echo
# The two-writer trap (plan §10.4): the preview defaults to the same data/chomp.db
# the live process owns. Since the ownership guard landed, an unset CHOMP_DB_PATH is
# a hard refusal rather than silent corruption — but we set a scratch path here so
# the preview simply works, and so submissions never land on the real board.
stop_port

echo
echo "  starting…"
NEXT_DIST_DIR="$TARGET" \
BUILD_ID="$STAMP" \
CHOMP_DB_PATH="$SCRATCH_DB" \
  nohup node node_modules/next/dist/bin/next start -p "$PORT" \
  > /tmp/preview-$PORT.log 2>&1 &

# `curl && break` would abort the whole script under `set -e` on the first failed
# poll — which is every poll before the server is up. Use an if, not a shortcut.
for _ in $(seq 1 40); do
  sleep 0.5
  if curl -sf -o /dev/null -m 2 "http://127.0.0.1:$PORT/"; then break; fi
done

if ! curl -sf -o /dev/null -m 5 "http://127.0.0.1:$PORT/"; then
  echo "!! preview did not come up. Log:" >&2
  tail -20 "/tmp/preview-$PORT.log" >&2
  exit 1
fi

# ── The whole point: read the stamp back OFF THE RUNNING SERVER ────────────────
# Not from $STAMP, which is only what we INTENDED to serve.
#
# The extraction is deliberately GENERIC — it reads whatever stamp the server is
# using, rather than searching for the one we expect. Grepping for $STAMP would
# return empty against a stale build and report "could not read", which is a
# different and much weaker statement than "it is serving something else". A real
# mismatch has to be able to name the wrong value.
#
# `asset()` appends ?v=<BUILD_ID> to every public asset URL (src/lib/asset.ts), so
# the stamp is on every page. There is no `buildId` key in the payload to read.
SERVED="$(curl -s -m 10 "http://127.0.0.1:$PORT/" | grep -oE '[?&]v=[A-Za-z0-9_.-]+' | head -1 | cut -d= -f2)"

echo
echo "  ────────────────────────────────────────────────"
echo "   SERVING:  ${SERVED:-<could not read>}"
echo "   EXPECTED: $STAMP"
if [ "$SERVED" = "$STAMP" ]; then
  echo "   MATCH ✓   measurements off :$PORT describe $STAMP"
else
  echo "   MISMATCH ✗  DO NOT TRUST ANY MEASUREMENT FROM THIS PORT."
  echo "   A stale process is serving a different (possibly deleted) build."
  echo "   Run: deploy/preview.sh --stop   then start again."
fi
echo "  ────────────────────────────────────────────────"
echo
echo "  http://127.0.0.1:$PORT   ·   log: /tmp/preview-$PORT.log"
echo "  stop: deploy/preview.sh --stop"
