# QA's catch rate

A script of Focus's own (it runs in the terminal, never in Focus): it measures QA, which is the core's. The [flow plugin](../plugins/flow/README.md) shows the latest run among `pnpm run flow`'s quality guards, through the plugin API (`latestQaCatch`).

`pnpm run qa-catch` measures how many real bugs QA catches. QA passing nine pull requests in ten first time could be good work or a weak check, and only bugs planted on purpose tell which. It takes recently merged goal pull requests, plants one known bug in each, runs the QA officer's own review on that code, and counts how many QA catches.

| | |
| --- | --- |
| `pnpm run qa-catch` | the latest merged pull requests, a few reviews at a time |
| `pnpm run qa-catch --prs 4` | fewer (or more) |
| `pnpm run qa-catch --repo owner/name` | only one repo's |
| `pnpm run qa-catch --dry` | plants the bugs and says where, without running any review (free, a few seconds) |
| `pnpm run qa-catch --again` | the same pull requests as the last run, so the same bugs: to compare QA before and after a change to it |
| `pnpm run qa-catch --control` | also reviews each pull request with no bug planted, and counts the clean ones QA fails (false alarms): twice the reviews |

Each review costs what a QA review in Focus does: as of 2026-10, about $0.60 and a few minutes on Focus's QA model, so a default run is about $6–10 and half an hour or so. Each run is saved in `~/.focus/qa-catch/`, with what QA worked to: its crew file's digest, model and Focus's commit.

## How a run goes

For each of the goals' merged pull requests, newest first, in repos Focus has a copy of (`~/.focus/repos`):

1. **A throwaway clone** of its head, made from Focus's copy, with `origin/<base>` set to the base the pull request was opened against. Nothing is pushed, and no real pull request is touched.
2. **One bug, planted** in a line the pull request added (`plant` in `server/agents/qaCatch.ts`, whose rules are tested next to it), and committed on top, so it's part of the diff QA reviews. The bug is a small, plausible one: a comparison flipped or off by one, a condition the wrong way round, a guard dropped, a true turned false. It goes only in code QA can catch a bug in by reading the diff and running the tests, not in UI code (the replay has no browser), tests, docs or config. The same pull request always gets the same bug. A pull request with nothing that could take one is passed over.
3. **QA's own review**: a Claude Code session with the QA officer's system prompt, prompt, report schema, model and Claude Code settings, as Focus's, run in the clone. It runs with permissions bypassed, since nobody is there to answer a prompt, and the clone is deleted afterwards.
4. **The score** (`scoreReport`): **caught** when QA fails the pull request and its report points at the bug (by its file, or a spot-check near it); **failed for something else** when it fails it without pointing there; **missed** when it passes it. The rate is caught over the reviews that finished.

## Reading it

- **Missed** is the number to watch: a bug that would have reached `main`. Read each missed one's planted line, printed with the result.
- **Failed for something else** can mean QA found a different real problem in the pull request, or failed it for a reason that isn't one. It isn't counted as caught.
- **False alarms** (with `--control`): clean pull requests QA failed. Read why before counting one: QA can find a real bug the pull request merged with (the first one here was #368's gantry railings, whose colliders stood in the walkway). A change that raises the catch rate by failing everything shows here, so judge a change to QA by both.
- Run it again after changing QA (its prompt, its model, its checks) with `--again --control`, and compare. Run the same thing twice before trusting a difference of one or two: the same review can go either way from run to run.

## What it can't tell

- Focus's QA tests UI changes in a browser. The replay has none, so it plants bugs only where a browser isn't needed, and says nothing about QA's UI testing.
- One planted bug per pull request, of a few simple kinds. A real bug can be subtler (wrong logic that reads well) or louder (a crash every test catches). The rate is a floor for simple bugs, not a measure of every kind.
- A re-test round isn't replayed: Focus's QA, failing a pull request, sees it again once it's fixed. The replay stops at the first verdict.
