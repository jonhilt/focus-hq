# Configuration

| Env var | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `4477` / `127.0.0.1` | where the office listens |
| `FOCUS_DATA_DIR` | `~/.focus` | state, agent logs, repo clones, worktrees and preview checkouts |
| `FOCUS_MODE=demo` | | same as `--demo` |
| `FOCUS_BOARD_REFRESH_MS` | `60000` | how often boards re-read issues and PRs |
| `FOCUS_BROWSER_PATH` | | Chromium/Chrome binary for agent browser testing |
| `FOCUS_USE_API_KEY=1` | | let agents use `ANTHROPIC_API_KEY` instead of your Claude login |
| `FOCUS_USE_API_KEY=fallback` | | agents use your Claude login, and `ANTHROPIC_API_KEY` while your plan's usage limit is reached ([your API key when your plan runs out](api-key.md)) |
| `FOCUS_API_BUDGET` | `20` | the most, in dollars, the key spends each time your plan's limit is reached (with `FOCUS_USE_API_KEY=fallback`) |
| `FOCUS_TERMINAL` | | the command that opens a terminal running a script, e.g. `kitty -e`, for starting [cloud sessions](cloud-agents.md); tried before the platform's own |
| `FOCUS_DEMO_SPEED` | `1` | speed up the pretend agents in demo mode |
| `FOCUS_AUTO_UPDATE=0` | | turn off auto update |
| `FOCUS_UPDATE_CHECK_MS` | `300000` | how often auto update checks for new commits |
| `FOCUS_WHISPER_BIN` | `whisper-cli` | whisper.cpp's CLI for [voice input](voice-input.md) |
| `FOCUS_WHISPER_MODEL` | `~/.focus/models/ggml-large-v3-turbo-q5_0.bin` | the speech model for voice input |

## Merge method

The board's merge button, and auto-merge, merge a pull request with **Settings → merge method** (squash, merge or rebase) in the ready room. A repo can merge its own way: each repository under **Projects** has a picker beside its name, `default` to follow Settings, or squash, merge or rebase for that repo alone, which wins over Settings (`mergeMethodFor` in `shared/mergeGate.ts`). The merge button says which it'll use.
