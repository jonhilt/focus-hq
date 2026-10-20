#!/usr/bin/env bash
# Snapshots the office's state (~/.focus, less what's rebuilt: rebuilt.txt) into a dated tarball, keeps the newest
# FOCUS_BACKUP_KEEP (14), and copies it to FOCUS_BACKUP_TARGET with rsync if that's set (`mac:Backups/focus/`, a NAS:
# anywhere off this machine).
set -euo pipefail
data=${FOCUS_DATA_DIR:-$HOME/.focus}
dest=${FOCUS_BACKUP_DIR:-$HOME/focus-backups}
keep=${FOCUS_BACKUP_KEEP:-14}
here=$(cd "$(dirname "$0")" && pwd)

mapfile -t rebuilt < <(grep -v '^#' "$here/rebuilt.txt" | grep .)
names=()
for entry in "$data"/* "$data"/.[!.]*; do
  [[ -e $entry ]] || continue
  name=$(basename "$entry")
  [[ " ${rebuilt[*]} " == *" $name "* ]] || names+=("$name")
done

mkdir -p "$dest"
file=$dest/focus-$(date +%Y%m%d-%H%M%S).tgz
# the office keeps writing while this runs: state.json is replaced whole, the journals only grow
tar -czf "$file.partial" -C "$data" "${names[@]}"
mv "$file.partial" "$file"
echo "Backed up ${#names[@]} entries of $data to $file ($(du -h "$file" | cut -f1))"

ls -1t "$dest"/focus-*.tgz | tail -n +$((keep + 1)) | xargs -r rm --
if [[ -n ${FOCUS_BACKUP_TARGET:-} ]]; then
  rsync -a "$file" "$FOCUS_BACKUP_TARGET"
  echo "Copied to $FOCUS_BACKUP_TARGET"
fi
