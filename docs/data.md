# Data and backups

Everything the office keeps lives in `~/.focus/` (or `FOCUS_DATA_DIR`, see [Configuration](configuration.md)). The data dir is deliberately outside this repo. Otherwise agents working in a worktree under it would pick up this project's `CLAUDE.md`.

## What to back up

The office's memory of how work went is in two places. Back both up:

- **`~/.focus/`** (or `FOCUS_DATA_DIR`): `state.json` (projects, goals and their notes, open reviews), `ledger.jsonl` (see [the ledger](ledger.md)), `logs/` (each agent's terminal) and `qa-shots/`. Leave out `repos/`, `workspaces/`, `planning/`, `previews/`, `merges/`, `cloud-terminals/` and `models/`: the office rebuilds or re-downloads them.
- **`~/.claude/projects/-Users-<you>--focus-*/`**: the agents' Claude Code transcripts, which the chief engineer reads. Claude Code deletes transcripts older than 30 days unless `cleanupPeriodDays` in `~/.claude/settings.json` says otherwise.
