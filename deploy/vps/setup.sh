#!/usr/bin/env bash
# Sets up a Linux server (Ubuntu 24.04 or Debian 12) to run Focus, reached over Tailscale.
# Run it as the user Focus runs as (not root, with sudo), from anywhere: it clones Focus if it isn't there yet.
# Safe to run again: each step skips what's already done. From your Mac: `scp deploy/vps/setup.sh <server>:` then
# `ssh -t <server> ./setup.sh`. Switch on HTTPS certificates for the tailnet first (admin console → DNS, MagicDNS).
#
# Size: about 2 GB of memory per agent at once plus a few for Focus (16 GB, 4–8 vCPUs is comfortable), 80 GB+ disk.
# On a server: whisper.cpp and Kokoro run on its CPU; any device a person on the tailnet owns controls Focus
# (FOCUS_ALLOWED_LOGINS narrows it to some; a tagged device reaches only the bot's routes: docs/settings.md#who-reaches-focus). Don't copy your Mac's ~/.claude/settings.json
# as it is: hooks with Mac paths fail on every tool call. Other settings go in ~/.config/focus/env, then
# `sudo systemctl restart focus`. Moving Focus: migrate.sh. Backups: backup.sh (restore: stop focus, untar over
# ~/.focus, start it). Agents' sessions don't move (Claude Code names transcripts by path): they start new ones.
#
#   FOCUS_REPO   the repo to clone (default jonhilt/focus)
#   FOCUS_DIR    where (default ~/focus)
#   FOCUS_SKIP   steps to leave out, space-separated: tailscale, login, systemd (for a container without them)
set -euo pipefail

FOCUS_REPO=${FOCUS_REPO:-jonhilt/focus}
FOCUS_DIR=${FOCUS_DIR:-$HOME/focus}
FOCUS_SKIP=${FOCUS_SKIP:-}
ENV_FILE=$HOME/.config/focus/env

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
skipping() { [[ " $FOCUS_SKIP " == *" $1 "* ]]; }
have() { command -v "$1" >/dev/null 2>&1; }

if [[ $EUID -eq 0 ]]; then
  echo "Run this as the user Focus will run as, not root (it uses sudo where it needs to)." >&2
  exit 1
fi

say "System packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git curl ca-certificates gnupg build-essential python3 jq rsync >/dev/null

say "Node.js 22 and pnpm"
if ! have node || (( $(node -p 'process.versions.node.split(".")[0]') < 20 )); then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
sudo corepack enable
node --version

say "GitHub CLI"
if ! have gh; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg status=none
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gh >/dev/null
fi
gh --version | head -1

say "Claude Code (for signing in: Focus's agents run the SDK's own copy)"
if ! have claude && [[ ! -x $HOME/.local/bin/claude ]]; then
  curl -fsSL https://claude.ai/install.sh | bash
fi
export PATH=$HOME/.local/bin:$PATH

if ! skipping tailscale; then
  say "Tailscale"
  have tailscale || curl -fsSL https://tailscale.com/install.sh | sh
  if ! tailscale status >/dev/null 2>&1; then
    echo "Sign this machine in to your tailnet:"
    sudo tailscale up
  fi
  # lets Focus's user run `tailscale cert` and `tailscale serve` without sudo
  sudo tailscale set --operator="$USER"
fi

if ! skipping login; then
  say "GitHub sign-in (agents' pull requests and pushes go through it)"
  gh auth status >/dev/null 2>&1 || gh auth login --git-protocol https --web
  gh auth setup-git

  say "Git identity (the agents' commits are made as you)"
  [[ -n $(git config --global user.name || true) ]] || { read -rp "Your name for commits: " name; git config --global user.name "$name"; }
  [[ -n $(git config --global user.email || true) ]] || { read -rp "Your email for commits: " email; git config --global user.email "$email"; }
fi

say "Focus in $FOCUS_DIR"
if [[ ! -e $FOCUS_DIR/.git ]]; then
  gh repo clone "$FOCUS_REPO" "$FOCUS_DIR" 2>/dev/null || git clone "https://github.com/$FOCUS_REPO.git" "$FOCUS_DIR"
fi
cd "$FOCUS_DIR"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
pnpm build

say "Chromium for the agents' browser (and its system libraries)"
pnpm exec playwright install --with-deps chromium

say "Focus's environment: $ENV_FILE"
mkdir -p "$(dirname "$ENV_FILE")"
if [[ ! -f $ENV_FILE ]]; then
  install -m 600 "$FOCUS_DIR/deploy/vps/env.example" "$ENV_FILE"
fi
if ! skipping login && ! grep -q '^CLAUDE_CODE_OAUTH_TOKEN=.' "$ENV_FILE" && ! grep -q '^FOCUS_USE_API_KEY=1' "$ENV_FILE"; then
  echo "Agents need your Claude login. Make a long-lived token for this machine (it opens a link to sign in):"
  claude setup-token
  read -rsp "Paste the token (sk-ant-oat…): " token && echo
  sed -i "s|^#\? *CLAUDE_CODE_OAUTH_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN=$token|" "$ENV_FILE"
fi

if ! skipping systemd; then
  say "systemd: Focus, its preview certificate and its backups"
  render() { sed -e "s|@USER@|$USER|g" -e "s|@HOME@|$HOME|g" -e "s|@FOCUS_DIR@|$FOCUS_DIR|g" "$FOCUS_DIR/deploy/vps/$1" | sudo tee "/etc/systemd/system/$1" >/dev/null; }
  render focus.service
  render focus-cert.service
  render focus-cert.timer
  render focus-backup.service
  render focus-backup.timer
  sudo systemctl daemon-reload
  sudo systemctl enable --now focus-backup.timer
  sudo systemctl enable --now focus-cert.timer
  sudo systemctl start focus-cert.service || echo "No preview certificate yet: switch on HTTPS certificates for your tailnet (the Tailscale admin console), then: sudo systemctl start focus-cert"
  sudo systemctl enable focus.service
  sudo systemctl restart focus.service
fi

if ! skipping tailscale; then
  say "Tailscale Serve: https://<this machine>.<tailnet>.ts.net → Focus"
  tailscale serve --bg 4477
  tailscale serve status
fi

say "Done"
cat <<EOF
Next (the top of deploy/vps/setup.sh says more):
  - Claude Code settings: write ~/.claude/settings.json for this machine (your Mac's has Mac paths in its hooks).
  - Moving from your Mac: stop Focus there, then from your Mac's checkout: deploy/vps/migrate.sh <this server>.
  - Logs: journalctl -u focus -f
EOF
