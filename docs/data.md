# Data and backups

Everything the office keeps lives in `~/.focus/` (or `FOCUS_DATA_DIR`, see [Configuration](configuration.md)). The data dir is deliberately outside this repo. Otherwise agents working in a worktree under it would pick up this project's `CLAUDE.md`.

## One office per data folder

Only one office uses a data folder at a time. The first takes `state.json.lock` (holding its process id), and another office started on the same folder refuses to start: each would otherwise save its own copy of `state.json` over the other's, and a QA verdict one of them gave would come back as the other's older one. To run a second office alongside, give it a folder of its own (`FOCUS_DATA_DIR=<empty folder>`), or run `npm run demo`, which saves nothing. A lock left by an office that's gone is taken over.

`state.json` is saved a moment after each change (changes close together are written once). What's still waiting is written when the office exits, crash or restart included. The store also refuses a review that would put back a QA verdict older than the one it holds, the kind of copy a step that waited on GitHub could otherwise write back.

## What to back up

The office's memory of how work went is in two places. Back both up:

- **`~/.focus/`** (or `FOCUS_DATA_DIR`): `state.json` (projects, goals and their notes, open reviews), `ledger.jsonl` (see [the ledger](ledger.md); any `ledger.jsonl.damaged-…` or `.v1-…` copies beside it are kept on purpose), `logs/` (each agent's terminal) and `qa-shots/`. Leave out `repos/`, `workspaces/`, `planning/`, `previews/`, `merges/`, `cloud-terminals/` and `models/`: the office rebuilds or re-downloads them.
- **`~/.claude/projects/-Users-<you>--focus-*/`**: the agents' Claude Code transcripts, which the chief engineer reads. Claude Code deletes transcripts older than 30 days unless `cleanupPeriodDays` in `~/.claude/settings.json` says otherwise.
