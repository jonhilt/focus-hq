# Configuration

| Env var | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `4477` / `127.0.0.1` | where the office listens |
| `FOCUS_DATA_DIR` | `~/.focus` | state, agent logs, repo clones, worktrees and preview checkouts |
| `FOCUS_MODE=demo` | | same as `--demo` |
| `FOCUS_BOARD_REFRESH_MS` | `60000` | how often boards re-read issues and PRs |
| `FOCUS_BROWSER_PATH` | | Chromium/Chrome binary for agent browser testing |
| `FOCUS_USE_API_KEY=1` | | let agents use `ANTHROPIC_API_KEY` instead of your Claude login |
| `FOCUS_DEMO_SPEED` | `1` | speed up the pretend agents in demo mode |
| `FOCUS_AUTO_UPDATE=0` | | turn off auto update |
| `FOCUS_UPDATE_CHECK_MS` | `300000` | how often auto update checks for new commits |
| `FOCUS_WHISPER_BIN` | `whisper-cli` | whisper.cpp's CLI for [voice input](voice-input.md) |
| `FOCUS_WHISPER_MODEL` | `~/.focus/models/ggml-large-v3-turbo-q5_0.bin` | the speech model for voice input |
