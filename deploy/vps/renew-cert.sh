#!/usr/bin/env bash
# Fetches this machine's ts.net certificate into the office's data folder, where preview mirrors pick it up as they
# open (server/previewMirrors.ts). Needs HTTPS certificates switched on for the tailnet, and the user to be
# tailscale's operator (setup.sh does that).
set -euo pipefail
dir=${FOCUS_DATA_DIR:-$HOME/.focus}/tls
name=$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')
mkdir -p "$dir"
tailscale cert --cert-file "$dir/preview.crt" --key-file "$dir/preview.key" "$name"
chmod 600 "$dir/preview.key"
echo "Preview certificate for $name in $dir"
