# Configuration

| Env var | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `4477` / `127.0.0.1` | where the office listens. Any other `HOST` than a loopback one puts the office, which has no login, in reach of anyone who can reach the port, and it says so as it starts |
| `FOCUS_ALLOWED_HOSTS` | | more names a browser may reach the office by, comma-separated (`.example.com` for any name under it); see [who the office answers](#who-the-office-answers) |
| `FOCUS_DATA_DIR` | `~/.focus` | state, agent logs, repo clones, worktrees and preview checkouts |
| `FOCUS_MODE=demo` | | same as `--demo` |
| `FOCUS_BOARD_REFRESH_MS` | `60000` | how often boards re-read issues and PRs |
| `FOCUS_PREVIEW_HOSTS` | the tailnet addresses | where previews' sites are [mirrored for other machines](previews.md#from-another-machine), comma-separated, or `off` |
| `FOCUS_PREVIEW_CERT` / `FOCUS_PREVIEW_KEY` | `~/.focus/tls/preview.crt` / `.key` | a certificate and key (from `tailscale cert`) that make the mirrors https |
| `FOCUS_BROWSER_PATH` | | Chromium/Chrome binary for agent browser testing |
| `FOCUS_USE_API_KEY=1` | | let agents use `ANTHROPIC_API_KEY` instead of your Claude login |
| `FOCUS_USE_API_KEY=fallback` | | agents use your Claude login, and `ANTHROPIC_API_KEY` while your plan's usage limit is reached ([your API key when your plan runs out](api-key.md)) |
| `FOCUS_API_BUDGET` | `20` | the most, in dollars, the key spends each time your plan's limit is reached (with `FOCUS_USE_API_KEY=fallback`) |
| `FOCUS_TERMINAL` | | the command that opens a terminal running a script, e.g. `kitty -e`, for starting [cloud sessions](cloud-agents.md); tried before the platform's own |
| `FOCUS_DEMO_SPEED` | `1` | the pace the demo's pretend agents start at: above 1 is faster, below slower ([demo pace](#demo-pace)) |
| `FOCUS_PLUGINS` | none (`all` in the demo) | the [plugins](plugins.md) to switch on, comma-separated: names of folders under `plugins/` (like `climber`), paths to plugin folders anywhere, or `all` for every folder under `plugins/`. The demo office (`pnpm run demo`, `demo:start`) has them all unless it's set; set it empty (`FOCUS_PLUGINS=`) for a demo with none. The scripts that start their own demo office (smoke, perf, flows, the scans) always have them all, whatever it's set to |
| `FOCUS_AUTO_UPDATE=0` | | turn off auto update |
| `FOCUS_UPDATE_CHECK_MS` | `300000` | how often auto update checks for new commits |
| `FOCUS_WHISPER_BIN` | `whisper-cli` | whisper.cpp's CLI for [voice input](voice-input.md) |
| `FOCUS_KOKORO_GPU` | on | `0` keeps the crew's voices (Kokoro) on the CPU rather than the Apple GPU ([Number One's voice mode](../plugins/number-one/README.md#voice-mode)) |
| `FOCUS_WHISPER_MODEL` | `~/.focus/models/ggml-large-v3-turbo-q5_0.bin` | the speech model for voice input |
| `OPENAI_API_KEY` / `TYPESAFE_API_KEY` | | both needed for [calls to Number One](../plugins/number-one/calls.md) (the `number-one` plugin): gpt-live-1 and Jev |
| `FOCUS_LIVE_VOICE` | `cedar` | gpt-live-1's voice on calls |

## Demo pace

How fast a demo office's pretend agents go. At 1× (`pnpm run demo`'s) a lead's tool calls take a second or two, and a
workflow's agents work as a real subagent does, for tens of seconds to a couple of minutes each: the review workflow's
38 agents, eight at a time, take several minutes, and mapping the repos a minute or two. The office starts at
`FOCUS_DEMO_SPEED`; in a demo office, the ready room's **Settings** has a **Demo pace** control (**Slower**, the pace
now, **Faster**), stepping through 0.1×, 0.25×, 0.5×, 0.75×, 1×, 1.5×, 2× and 3× (`shared/demoPace.ts`), and **-** and
**=** do the same while you walk the ship. It changes
for every pretend agent at once, from its next wait (a workflow agent at work speeds up or slows down there and then),
and every tab shows the new pace (the snapshot's `info.demoPace`). Scripts set it with `POST /api/demo/speed` and
`{ "speed": 2 }`, kept to the ladder's range.

## Who the office answers

The office has no login, so it only answers your own browser. A request whose `Host` isn't one it knows is refused with a 403: that's another site's name pointed at your machine (DNS rebinding). So is one whose `Origin` isn't: that's another site's page, or a sandboxed one like a lead's artifact, trying to drive your agents. This applies to `/api`, the pages and the `/ws` socket. Requests with no `Origin` (scripts, `curl`) need only a known `Host`. The office knows `localhost`, `127.0.0.1`, `[::1]`, anything under `.ts.net` (the [Tricorder](tricorder.md) through Tailscale Serve), `HOST` itself (with `HOST=0.0.0.0`, the machine's name and addresses), and `FOCUS_ALLOWED_HOSTS`. Each refusal is logged with its reason. The check is `refusal` in `server/hostGuard.ts`.

## Merge method

The board's merge button, and auto-merge, merge a pull request with **Settings → merge method** (squash, merge or rebase) in the ready room. A repo can merge its own way: each repository under **Projects** has a picker beside its name, `default` to follow Settings, or squash, merge or rebase for that repo alone, which wins over Settings (`mergeMethodFor` in `shared/mergeGate.ts`). The merge button says which it'll use. Before any merge, the office runs the [merge check](merging.md): the PR merged onto its base, with the project's `mergeChecks` scripts run on it.
