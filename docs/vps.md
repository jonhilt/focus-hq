# Running the office on a server

The office can run on a Linux server instead of your Mac and be reached over [Tailscale](https://tailscale.com) from your Mac, laptop and phone. Everything moves together: the office, its agents' Claude Code sessions, their worktrees and the previews. The agents run inside the office's process (through the Agent SDK), so there's no splitting them up.

**Why:** it stays on when your Mac sleeps or you close the lid, your Mac's CPU and fans are yours again, and you reach the same office from any of your machines.

**What changes:**

| | |
| --- | --- |
| Previews | open from your other machines through their [mirrors](previews.md#from-another-machine), over https with the machine's certificate (`setup.sh` renews it weekly) |
| Voice input and the crew's voices | work (the office is on https through Tailscale Serve, and the mic is your browser's), but whisper.cpp and Kokoro run on the server's CPU rather than your Mac's GPU: slower. Install whisper.cpp yourself (`whisper-cli` on the `PATH`, or `FOCUS_WHISPER_BIN`), see [voice input](voice-input.md) |
| Cloud agents | the office can't open a terminal on a server: paste a claude.ai/code session link instead ([starting the session](cloud-agents.md)). They need a claude.ai login on the server (`claude`, then `/login`), not just the token below |
| Your editor | the worktrees are on the server: open them with VS Code's Remote-SSH (Tailscale SSH works for it) |
| Your secrets | your GitHub and Claude logins live on the server. Anyone on your tailnet who can reach it controls the office, as with the [Tricorder](tricorder.md) |

**Size:** about 2 GB of memory per agent working at once, plus a few GB for the office, its browser and previews. That makes 8 GB tight for the default 4 agents, and 16 GB with 4–8 vCPUs comfortable. You'll also want 80 GB or more of disk for the clones, worktrees and their `node_modules`. These are estimates, not measurements.

## Setting it up

You need a server with Ubuntu 24.04 or Debian 12, a user on it with sudo, and **HTTPS certificates** switched on for your tailnet (Tailscale admin console → DNS → HTTPS Certificates, with MagicDNS). Then, from your Mac:

```
scp deploy/vps/setup.sh <server>:
ssh <server> ./setup.sh
```

`setup.sh` (in `deploy/vps/`) installs Node 22, pnpm, git, the GitHub CLI, Claude Code, Tailscale and Playwright's Chromium with its system libraries. It asks you to sign in to Tailscale and GitHub (`gh auth setup-git` lets the office push), and for your name and email for the agents' commits. It clones Focus into `~/focus`, then installs and builds it. It asks for a Claude token (`claude setup-token` makes one from your subscription) and keeps it in `~/.config/focus/env`. Last, it installs three systemd units and puts the office on `https://<server>.<tailnet>.ts.net` with `tailscale serve`:

- `focus.service` runs the office and restarts it after a crash or an auto update.
- `focus-cert.service` and `focus-cert.timer` fetch the machine's certificate into `~/.focus/tls/` at boot and weekly.

Run it again at any time: it skips what's done. `FOCUS_REPO` and `FOCUS_DIR` change what it clones and where, and `FOCUS_SKIP="tailscale login systemd"` leaves those steps out (that's how it's tested, in a container).

The office keeps its usual settings: `HOST` stays `127.0.0.1`, and Tailscale Serve is the way in. Other settings ([configuration](configuration.md)) go in `~/.config/focus/env`, with `sudo systemctl restart focus` after.

### Claude Code's settings

Agents load your `~/.claude/settings.json` (permissions, hooks, plugins, env) as on your Mac. Don't copy your Mac's as it is: hooks with Mac paths (`/Users/you/.local/bin/dcg`) fail on every tool call. Write one for the server: install the tools your hooks run (dcg among them) for Linux, and point the hooks at their paths there. Copy `~/.claude/CLAUDE.md` and `~/.claude/rules/` across if you use them.

## Moving your office

The office's state is plain files in `~/.focus` ([what to back up](data.md#what-to-back-up)). Only one office may run on a data folder at a time, so stop the Mac's first, then copy what isn't rebuilt:

```
rsync -a --exclude repos --exclude workspaces --exclude planning --exclude previews --exclude merges \
  --exclude cloud-terminals --exclude models --exclude frame-stats --exclude dcg.toml --exclude tls \
  --exclude 'state.json.lock' ~/.focus/ <server>:.focus/
ssh <server> sudo systemctl restart focus
```

Projects, goals, boards, the ledger, logs and the leads' artifacts come across. Agents' sessions don't: Claude Code names its transcripts after the working directory's path, which is different on the server, so an agent that was mid-task starts a new session there. The office clones the repos again and makes fresh worktrees as agents need them.

## Looking after it

- Logs: `journalctl -u focus -f`. Restart: `sudo systemctl restart focus`.
- Updates: [auto update](auto-update.md) pulls, rebuilds and restarts as on your Mac.
- The certificate: `systemctl list-timers focus-cert.timer`, or `sudo systemctl start focus-cert` to fetch it now.
- Where it's reached: `tailscale serve status`.
