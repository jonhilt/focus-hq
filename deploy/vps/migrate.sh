#!/usr/bin/env bash
# Moves your office's state from this machine (your Mac) to a server set up with setup.sh: stops the office there,
# copies ~/.focus less what's rebuilt (rebuilt.txt), and starts it again. Stop the office here first: only one office
# may run on its state at a time. See docs/vps.md#moving-your-office.
#
#   deploy/vps/migrate.sh <server>
set -euo pipefail
server=${1:?usage: migrate.sh <server>}
data=${FOCUS_DATA_DIR:-$HOME/.focus}
here=$(cd "$(dirname "$0")" && pwd)

if [[ -f $data/state.json.lock ]] && kill -0 "$(cat "$data/state.json.lock")" 2>/dev/null; then
  echo "The office is still running here (pid $(cat "$data/state.json.lock")): stop it first." >&2
  exit 1
fi

excludes=()
while read -r name; do excludes+=(--exclude "/$name"); done < <(grep -v '^#' "$here/rebuilt.txt" | grep .)

ssh -t "$server" sudo systemctl stop focus
rsync -a "${excludes[@]}" "$data/" "$server:.focus/"
ssh -t "$server" sudo systemctl start focus
echo "Moved. The office runs on $server now: https://$server.<tailnet>.ts.net (tailscale serve status there)."
