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

# ─── ONE CLEANUP FUNCTION, ONE TRAP. APPEND HERE; DO NOT ADD A SECOND TRAP. ──────────
#
# `trap ... EXIT` REPLACES any existing EXIT trap rather than adding to it, so a second
# one anywhere below silently disables everything in here. build.sh and dev.sh carry the
# same structure, after a second trap was nearly added to build.sh and would have left a
# tracked file dirty. The verifier below allocates three temp files and can exit from six
# places; registering them here is what makes every one of those paths clean.
TMPFILES=()
cleanup() {
  [ "${#TMPFILES[@]}" -gt 0 ] && rm -f "${TMPFILES[@]}"
  return 0
}
trap cleanup EXIT INT TERM

# `--verify <id>` runs the manifest check against a build and STOPS — no symlink, no pm2,
# no marker written. *Added 2026-08-13 with the check itself*, for two reasons: it lets you
# ask "is this rollback target still intact?" while nothing is on fire, which is the only
# calm moment to find out; and it makes the guard testable on the real code path, rather
# than on a copy of it in a test harness that could drift.
VERIFY_ONLY=0
if [ "${1:-}" = "--verify" ] || [ "${1:-}" = "--check" ]; then
  VERIFY_ONLY=1
  shift
fi
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

# --- verify the target against its manifest -------------------------------------
#
# *Added 2026-08-13.* The check above ("the directory exists and has a BUILD_ID") is an
# existence test. build.sh's completeness check runs where the data is FRESH — on the
# directory it just produced — and promote.sh runs where the data is TRUSTED, which can be
# weeks later. A build truncated, half-deleted, cut short by a full disk or badly rsynced
# in between used to promote in silence.
#
# THIS RUNS BEFORE THE SYMLINK SWAP. Verifying afterwards produces an accurate report
# about a site that is already down.
#
# Missing files and size mismatches REFUSE. Extra files only warn: every failure this
# guards against removes a file or changes its size, while extra files turn up for benign
# reasons (a stray dev server wrote into a build directory once, which is part of why this
# exists) and refusing on them would make the guard the outage.
verify_target() {
  local target="$1"
  local manifest="$target/BUILD_MANIFEST"
  local built="$target/BUILT"

  # ── A MISSING BUILT IS DAMAGE, NOT AGE. ──────────────────────────────────────
  # *Tightened 2026-08-13.* Every promote-able build directory has a BUILT file — the 12
  # that predated the convention were backfilled when this branch was added (see
  # deploy/README.md). So its absence is not the signature of an old build; it is the
  # signature of something wrong, and grandfathering on it was the last fail-open here:
  # a build that lost both its manifest and its BUILT would have promoted unverified
  # behind a banner nobody reads at 3am.
  #
  # The way past is a DECLARATION rather than a flag, which is this repo's pattern for
  # exactly this trade (chomp's CHOMP_DB_OWNER, and the rule that a guard must never be a
  # hard stop on the path OUT of an incident): if you have looked at the directory and
  # know it is a real build, write the file and say so. That takes a deliberate act, it
  # leaves a record on disk, and it cannot be typed reflexively as a command prefix.
  if [ ! -f "$built" ]; then
    echo "!! REFUSING to promote $target — it has no BUILT file." >&2
    echo "   Every build directory has one; a missing BUILT means something removed it," >&2
    echo "   not that the build is old. Promoting it would mean promoting a directory" >&2
    echo "   whose contents cannot be checked at all." >&2
    echo >&2
    echo "   If you have looked and know this directory is intact, declare it:" >&2
    echo "       printf 'DECLARED_AT=%s\\n' \"\$(date -u +%F)\" > $built" >&2
    echo "   and re-run. Otherwise rebuild: deploy/build.sh" >&2
    echo >&2
    echo "   DECLARED_AT, not BACKFILLED_AT: they are different claims and the next" >&2
    echo "   person to read this directory needs to be able to tell them apart." >&2
    echo "   BACKFILLED = reconstructed from what was knowable, in daylight." >&2
    echo "   DECLARED   = an operator vouched for it by hand, probably at 2am." >&2
    exit 1
  fi

  # THE MIGRATION DISCRIMINATOR. Read from BUILT, not from the manifest — a missing
  # manifest cannot tell you whether it was never written or has been deleted.
  local claims_manifest=no
  if LC_ALL=C grep -qx 'MANIFEST=1' "$built"; then claims_manifest=yes; fi

  # ── FAIL CLOSED ──────────────────────────────────────────────────────────────
  # A manifest that is absent, empty or truncated must not silently skip verification.
  # This is the branch a truncated build actually hits.
  if [ ! -s "$manifest" ]; then
    if [ "$claims_manifest" = yes ]; then
      echo "!! REFUSING to promote $target." >&2
      echo "   Its BUILT says MANIFEST=1, so build.sh wrote a manifest — and" >&2
      echo "   $manifest is now $([ -e "$manifest" ] && echo "EMPTY" || echo "MISSING")." >&2
      echo "   That is exactly the damage this check exists to catch. Rebuild:" >&2
      echo "       deploy/build.sh" >&2
      exit 1
    fi
    # WHICH KIND OF UNVERIFIED BUILD THIS IS. *Added 2026-08-13.* There are three ways a
    # directory can reach this branch and they are three different claims about how much
    # anyone knows about it. The banner names which, because this is the moment somebody
    # needs to know — and the weakest of the three used to look identical to the strongest.
    local declared_at backfilled_at kind detail
    declared_at="$(LC_ALL=C sed -n 's/^DECLARED_AT=//p' "$built" | head -1)"
    backfilled_at="$(LC_ALL=C sed -n 's/^BACKFILLED_AT=//p' "$built" | head -1)"
    if [ -n "$declared_at" ]; then
      kind="DECLARED BY HAND on $declared_at"
      detail="an operator vouched for this directory at a refusal — by definition under pressure. It has NO build-time provenance, and nothing has ever checked its contents."
    elif [ -n "$backfilled_at" ]; then
      kind="BACKFILLED on $backfilled_at"
      detail="its provenance was reconstructed after the fact because it predates BUILT/manifest writing. Its contents have never been checked."
    else
      kind="PRE-MANIFEST"
      detail="its BUILT was written at build time, before manifests existed, so there is nothing to check the contents against."
    fi

    echo "  !! UNVERIFIED BUILD — $target has no manifest."
    echo "     KIND: $kind"
    echo "     $detail"
    echo "     Promoting it is allowed on purpose: refusing here would make every"
    echo "     pre-manifest rollback target unusable in the name of protecting it."
    echo
    return 0
  fi

  # The manifest must validate itself before anything is validated against it.
  if [ "$(head -1 "$manifest")" != "MANIFEST_VERSION=1" ]; then
    echo "!! REFUSING: $manifest has an unrecognised first line." >&2
    echo "   got: $(head -1 "$manifest")" >&2
    echo "   A newer build.sh may have written it; this promote.sh cannot read it." >&2
    exit 1
  fi
  if [ "$(tail -1 "$manifest")" != "END_MANIFEST" ]; then
    echo "!! REFUSING: $manifest is TRUNCATED (no END_MANIFEST terminator)." >&2
    echo "   A manifest cut short describes a subset of the build and would verify" >&2
    echo "   clean against a build that is missing everything it forgot to mention." >&2
    exit 1
  fi

  local declared listed
  declared="$(LC_ALL=C sed -n 's/^FILE_COUNT=//p' "$manifest" | head -1)"
  listed="$(LC_ALL=C grep -c '^SIZE	' "$manifest" || true)"
  if [ -z "$declared" ] || ! [ "$declared" -eq "$declared" ] 2>/dev/null; then
    echo "!! REFUSING: $manifest has no usable FILE_COUNT." >&2
    exit 1
  fi
  if [ "$declared" != "$listed" ]; then
    echo "!! REFUSING: $manifest is INTERNALLY INCONSISTENT." >&2
    echo "   FILE_COUNT=$declared but it lists $listed files." >&2
    exit 1
  fi

  local expected actual extras
  expected="$(mktemp)"; actual="$(mktemp)"; extras="$(mktemp)"
  TMPFILES+=("$expected" "$actual" "$extras")   # cleanup() owns them from here
  LC_ALL=C awk -F'\t' '$1 == "SIZE" { printf "%s\t%s\n", $3, $2 }' "$manifest" \
    | LC_ALL=C sort > "$expected"
  # BUILD_MANIFEST is not in its own list, and DEPLOYED is written by THIS script on a
  # previous promote — neither is a discrepancy.
  ( cd "$target" && find . -type f -printf '%P\t%s\n' ) \
    | LC_ALL=C grep -vE '^(BUILD_MANIFEST|DEPLOYED)	' \
    | LC_ALL=C sort > "$actual"

  local bad=0
  # Whole-line comparison: a size change shows up here as a non-matching expected line.
  while IFS=$'\t' read -r path size; do
    local present
    present="$(LC_ALL=C awk -F'\t' -v p="$path" '$1 == p { print $2; exit }' "$actual")"
    if [ -z "$present" ]; then
      echo "   MISSING  $path: $size expected, absent"
    else
      echo "   SIZE     $path: $size expected, $present present"
    fi
    bad=$((bad + 1))
  done < <(LC_ALL=C comm -23 "$expected" "$actual")

  LC_ALL=C comm -13 "$expected" "$actual" \
    | LC_ALL=C awk -F'\t' 'NR==FNR { known[$1]; next } !($1 in known) { print "   EXTRA    " $1 " (" $2 " bytes, not in the manifest)" }' \
      "$expected" - > "$extras" || true

  local n_expected n_actual
  n_expected="$(wc -l < "$expected" | tr -d ' ')"
  n_actual="$(wc -l < "$actual" | tr -d ' ')"

  if [ "$bad" != 0 ]; then
    echo "!! REFUSING to promote $target — $bad file(s) do not match the manifest." >&2
    echo "   manifest: $n_expected files · on disk: $n_actual" >&2
    echo "   The paths and deltas are listed above. Rebuild rather than promoting this." >&2
    exit 1
  fi

  # Contents, for the three files where contents are what matter.
  local sha_bad=0
  while IFS=$'\t' read -r _ file want; do
    local got
    got="$(sha256sum "$target/$file" 2>/dev/null | cut -d' ' -f1)"
    if [ "$got" != "$want" ]; then
      echo "   CONTENT  $file: sha256 $want expected, ${got:-absent} present"
      sha_bad=$((sha_bad + 1))
    fi
  done < <(LC_ALL=C grep '^SHA256	' "$manifest")
  if [ "$sha_bad" != 0 ]; then
    echo "!! REFUSING to promote $target — $sha_bad manifest file(s) have wrong contents." >&2
    exit 1
  fi

  echo "  verified: $n_expected files match the manifest (size + path), 3 checksummed."
  if [ -s "$extras" ]; then
    echo "  !! $(wc -l < "$extras" | tr -d ' ') file(s) present that the build did not write."
    echo "     Not a refusal — nothing this check guards against ADDS files — but worth a look:"
    head -10 "$extras"
  fi
}

if [ "$VERIFY_ONLY" = 1 ]; then
  echo "=== onegrainofrice · verify $TARGET (no promote) ==="
fi
verify_target "$TARGET"
if [ "$VERIFY_ONLY" = 1 ]; then
  echo "=== verify only: nothing was promoted, nothing was restarted ==="
  exit 0
fi

CURRENT_LINK="$(readlink .next 2>/dev/null || true)"   # empty if .next is a real dir
echo "=== onegrainofrice · promote ==="
echo "target:   $TARGET   (BUILD_ID $(cat "$TARGET/BUILD_ID"))"
echo "current:  ${CURRENT_LINK:-<./.next is a real directory — first promote>}"
# THE ROLLBACK COMMAND, UP FRONT AND READ FROM THE SYMLINK RATHER THAN REMEMBERED.
# It is also printed at the end, but the end is ~90 lines and a pm2 restart away: if
# this promote wedges, the operator needs the way back on screen BEFORE the switch, not
# after it. Reported by hand once and reported wrong once — the value below is the only
# authority, so quote this line rather than recalling what was live.
if [ -n "${CURRENT_LINK#builds/}" ] && [ "$CURRENT_LINK" != "$CURRENT_LINK#builds/" ]; then
  echo "replacing ${CURRENT_LINK} — rollback: deploy/promote.sh ${CURRENT_LINK#builds/}"
fi
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
#
# There are THREE such flags now (chomp, grainsnake and tetrice), checked in one loop so
# a fourth game is one word rather than a fourth copied paragraph.
PM2_ENV="$(pm2 jlist 2>/dev/null || true)"
for flag in CHOMP_DB_OWNER GRAINSNAKE_DB_OWNER TETRICE_DB_OWNER; do
  case "$flag" in
    CHOMP_DB_OWNER)      api="/api/chomp/*" ;;
    GRAINSNAKE_DB_OWNER) api="/api/grainsnake/*" ;;
    TETRICE_DB_OWNER)    api="/api/tetrice/*" ;;
  esac
  if ! printf '%s' "$PM2_ENV" | grep -q "$flag"; then
    echo
    echo "  !! WARNING: the running process has no $flag."
    echo "     Builds carrying that leaderboard will answer 500 on"
    echo "     $api until it is injected. This is a ONE-TIME step:"
    echo
    echo "         pm2 restart ecosystem.config.js --only onegrainofrice --update-env"
    echo "         pm2 save"
    echo
    echo "     (Re-reads the config file, unlike the plain restart above. After"
    echo "      pm2 save it persists, so later promotes need nothing.)"
  fi
done

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
