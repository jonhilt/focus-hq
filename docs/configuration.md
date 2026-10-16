# Configuration

| Env var | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `4477` / `127.0.0.1` | where the office listens. Any other `HOST` than a loopback one puts the office, which has no login, in reach of anyone who can reach the port, and it says so as it starts |
| `FOCUS_ALLOWED_HOSTS` | | more names a browser may reach the office by, comma-separated (`.example.com` for any name under it); see [who the office answers](#who-the-office-answers) |
| `FOCUS_DATA_DIR` | `~/.focus` | state, agent logs, repo clones, worktrees and preview checkouts |
| `FOCUS_MODE=demo` | | same as `--demo` |
| `FOCUS_STUDIO=live` | | in the demo office, the studio's holodeck computer is a real Claude session, not scripted (`docs/studio.md`) |
| `FOCUS_BOARD_REFRESH_MS` | `60000` | how often boards re-read issues and PRs |
| `FOCUS_BROWSER_PATH` | | Chromium/Chrome binary for agent browser testing |
| `FOCUS_USE_API_KEY=1` | | let agents use `ANTHROPIC_API_KEY` instead of your Claude login |
| `FOCUS_USE_API_KEY=fallback` | | agents use your Claude login, and `ANTHROPIC_API_KEY` while your plan's usage limit is reached ([your API key when your plan runs out](api-key.md)) |
| `FOCUS_API_BUDGET` | `20` | the most, in dollars, the key spends each time your plan's limit is reached (with `FOCUS_USE_API_KEY=fallback`) |
| `FOCUS_TERMINAL` | | the command that opens a terminal running a script, e.g. `kitty -e`, for starting [cloud sessions](cloud-agents.md); tried before the platform's own |
| `FOCUS_DEMO_SPEED` | `1` | speed up the pretend agents in demo mode |
| `FOCUS_DEMO_SCENARIO` | `full` | which parts of its story a demo goal's lead plays: `full`, `subagents` or `workflow` ([the studio](studio.md#scenarios)) |
| `FOCUS_PLUGINS` | none (`all` in the demo) | the [plugins](plugins.md) to switch on, comma-separated: names of folders under `plugins/` (like `climber`), paths to plugin folders anywhere, or `all` for every folder under `plugins/`. The demo office (`pnpm run demo`, `demo:start`) has them all unless it's set; set it empty (`FOCUS_PLUGINS=`) for a demo with none. The scripts that start their own demo office (smoke, perf, the studio's recorder, the scans) always have them all, whatever it's set to |
| `FOCUS_AUTO_UPDATE=0` | | turn off auto update |
| `FOCUS_UPDATE_CHECK_MS` | `300000` | how often auto update checks for new commits |
| `FOCUS_WHISPER_BIN` | `whisper-cli` | whisper.cpp's CLI for [voice input](voice-input.md) |
| `FOCUS_KOKORO_GPU` | on | `0` keeps the crew's voices (Kokoro) on the CPU rather than the Apple GPU ([Number One's voice mode](../plugins/number-one/README.md#voice-mode)) |
| `FOCUS_WHISPER_MODEL` | `~/.focus/models/ggml-large-v3-turbo-q5_0.bin` | the speech model for voice input |
| `OPENAI_API_KEY` / `TYPESAFE_API_KEY` | | both needed for [calls to Number One](../plugins/number-one/calls.md) (the `number-one` plugin): gpt-live-1 and Jev |
| `FOCUS_LIVE_VOICE` | `cedar` | gpt-live-1's voice on calls |

## Who the office answers

The office has no login, so it only answers your own browser. A request whose `Host` isn't one it knows is refused with a 403: that's another site's name pointed at your machine (DNS rebinding). So is one whose `Origin` isn't: that's another site's page, or a sandboxed one like a lead's artifact, trying to drive your agents. This applies to `/api`, the pages and the `/ws` socket. Requests with no `Origin` (scripts, `curl`) need only a known `Host`. The office knows `localhost`, `127.0.0.1`, `[::1]`, anything under `.ts.net` (the [Tricorder](tricorder.md) through Tailscale Serve), `HOST` itself (with `HOST=0.0.0.0`, the machine's name and addresses), and `FOCUS_ALLOWED_HOSTS`. Each refusal is logged with its reason. The check is `refusal` in `server/hostGuard.ts`.

## Merge method

The board's merge button, and auto-merge, merge a pull request with **Settings → merge method** (squash, merge or rebase) in the ready room. A repo can merge its own way: each repository under **Projects** has a picker beside its name, `default` to follow Settings, or squash, merge or rebase for that repo alone, which wins over Settings (`mergeMethodFor` in `shared/mergeGate.ts`). The merge button says which it'll use.
