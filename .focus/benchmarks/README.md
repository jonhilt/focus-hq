# The benchmarks

What each of Focus's benchmarks runs, one file a benchmark: `<name>.yaml`, read by its script as it starts. A benchmark
measures one crew role's work on tasks with a known answer, so a change to that role (its crew file, its model, its
effort) can be judged by numbers before it merges. The code still decides what each benchmark's tasks are and how
they're scored (`server/agents/benchmarkFiles.ts` lists them); the file says how much of it to run, and what to compare.

| File | Script | Measures |
| --- | --- | --- |
| `qa-catch.yaml` | `pnpm run qa-catch` ([QA's catch rate](../../docs/qa-catch.md)) | QA, on a known bug planted in each recently merged goal pull request |
| `bug-replay.yaml` | `pnpm run bug-replay` ([replaying QA](../../docs/bug-corpus.md#replaying-qa)) | QA, on the commits real bugs came in with |

A file gives:

- `description`: what the benchmark measures, in a line.
- `role`: the crew role it measures (`qa` for both).
- `sample`: how many tasks a run takes, or left out for all of them. The script's flag for it (`--prs`, `--commits`) wins.
- `controls`: whether a run also reviews code with no bug in it, for false alarms. `--control` turns it on for a run.
- `concurrency`: how many reviews run at once.
- `judge` (`bug-replay` only): the `model`, `maxTurns` and `timeout` of the model that decides whether a finding is the
  bug the fix fixed.
- `configurations`: the ways of seating the role a run compares, on the same tasks. Each has a `name`, and any of:
  - `crew`: a git ref of Focus's repo (a branch, tag or commit) whose crew file for the role it's told, beside this
    checkout's others. Left out, it's this checkout's.
  - `model`, `effort`: the role's, for this configuration. Left out, the model is the one this machine's settings give
    the role (`~/.focus/state.json`) and the effort the model's default.

The first configuration is the run's own: the one earlier runs measured, `--again` reuses and `pnpm run flow` shows.
`--config a,b` runs only those, the first as the run's own. Each configuration costs a full run's reviews.

To try a change to QA's prompt, commit it to a branch, add a configuration with `crew:` set to that branch and run the
benchmark: each configuration's results are saved with the digest of the `qa.md` it was told, its model, effort and
Focus's commit. Like the crew files, a field nothing reads, a wrong value or a `crew` ref with no `qa.md` stops the run
before any review is paid for, naming the file and line.
