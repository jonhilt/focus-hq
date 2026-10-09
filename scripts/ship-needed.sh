#!/usr/bin/env bash
# Whether a branch needs its decks built (.github/workflows/ship.yml): prints true when the branch itself changes the
# Blender scripts (blender/) and no GLBs (client/public/ship/) have been built on it since its last script change.
# What the branch brings in from main by merging it doesn't count: main's scripts come with their GLBs.
#
#   scripts/ship-needed.sh [main ref, origin/main by default]
set -euo pipefail

main=${1:-origin/main}
base=$(git merge-base "$main" HEAD)

# the branch's scripts are main's (as far as it's merged): nothing of its own to build
if git diff --quiet "$base" HEAD -- blender; then
  echo false
  exit 0
fi

# the branch's latest commit of its own to change the scripts, and whether it built GLBs after it: merges of main
# bring main's scripts and GLBs, and count as neither
last=$(git rev-list -1 --no-merges "$base..HEAD" -- blender)
if [ -n "$last" ] && [ -n "$(git rev-list -1 --no-merges "$last..HEAD" -- client/public/ship)" ]; then
  echo false
else
  echo true
fi
