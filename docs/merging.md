# Merging and the merge check

Every time Ops merges a pull request, it runs the **merge check** first. The check builds what the base branch would look like with the PR in it (the PR's head merged onto the base as it is right now) and runs the repo's checks on that. If the merge conflicts or a check fails, Ops doesn't merge.

The reason is that a PR can be green on its own branch and still break main once it lands next to someone else's work. Before the check existed, Focus's history had 5 QA fails on PRs that only broke main after being merged with others, 4 on PRs that claimed green but weren't, and 9 bug fixes for parallel agents' work colliding. Nothing automatic ran before a merge.

## What it promises

Every merge Ops makes goes through it: the captain's merge button (the board's, or a card's in Comms), **Merge when QA passes** and auto-merge ([QA](qa.md)). PRs merged on GitHub itself don't go through Ops, so the check never sees them. `server/agents/merges.test.ts`, `server/focus.test.ts` and `shared/mergeCheck.test.ts` hold it to these:

- A PR merges only if git merged it onto its base by itself and every check passed (a repo with no checks to run counts as passing). Conflicts, a failing check, or a merge Ops couldn't build or run all refuse it.
- Ops merges exactly the head it checked. A PR that moved on from the commit the caller means to merge (QA's pass, say) is refused without checking.
- A trial is kept by its base and head, so trying again runs nothing until main moves or the PR gets a new push. A trial that couldn't run isn't kept, so it runs again next time.
- Merges in one repo go one at a time, shown as queued straight away, so each check runs against a base that already has the previous merge in it: the case the check exists for. A merge that lands on GitHub between the check and Ops' own merge isn't seen.
- Ops doesn't wait on the check: the board's refresh and the captain's request both return straight away.
- A refused PR stays open and says why, with a comment on the PR listing each command and the end of the failing one's output, and the ledger gets a `merge-check` line for every trial that runs. With auto-merge, the refusal blocks that head commit until something new is pushed. A "Merge when QA passes" request is dropped.

## Lanes: how a goal's lead's slice merges

A goal's lead ships each slice in a lane, after [Ship/Show/Ask](https://martinfowler.com/articles/ship-show-ask.html): **Ship** merges by itself once QA passes it, **Show** merges by itself and tells the captain, **Ask** waits for the captain to merge it (from its Comms card, or the board). It's there because the captain's time went on merging: of 271 merges from 14 to 22 October 2026, 270 were the captain's, a median of 8 minutes after QA passed. The project's auto-merge switch never reached a lead's pull request, and doesn't decide this: lanes hold on every project (the captain's call). `shared/mergeLane.ts` and `shared/mergeGate.ts` decide it; `mergeLane.test.ts`, `mergeGate.test.ts`, `server/focus.test.ts` and `manager.test.ts` hold it to these:

- **A lane is only ever raised.** The slice's [recap](goals.md#the-system-recap) sets the lowest the lead may pick: a slice that only composes primitives may Ship, one that extends any may Show, one that adds one is Ask. Ops refuses a ship below that. A lead that picks none is in Ask, and so is a pull request shipped before lanes.
- **Ship needs a clean pass at its head:** QA failing it, passing it with advice, or needing the captain holds it for the captain, as do a draft, a plugin claiming it, and the merge check refusing it. It goes through the merge check like every merge Ops makes.
- **A lead's failing checks are theirs to fix.** Ops re-runs them once, as for any PR, but never sends a developer to a lead's slice. Conflicts are merged in by Ops, as before, and the lead hears of it.
- **Show waits like Ask for now,** until Ops can tell the captain a slice landed on a card of its own.

The chief of staff raising a lane is still to come.

## Which checks

- By default the check runs the repo's `typecheck`, `lint` and `test` package.json scripts, whichever of them it has, using the package manager its lockfile names.
- **A repo can say exactly what to run**: if its package.json has a `merge-check` script, Ops runs that script and nothing else.
- **A project can choose different scripts** with `mergeChecks` on the project (`PATCH /api/projects/:id` with `{ "mergeChecks": ["typecheck", "test:unit"] }`, or a comma-separated string). An empty list runs no checks, so only conflicts stop a merge. `null` goes back to the default.
- A repo with no package.json, or none of the chosen scripts, runs no checks. Only conflicts stop its merges.

## Merging past it (the override)

If the check refused a PR, the captain can merge it anyway: it merges the head the captain saw, with no check, and the ledger notes the override (`overridden`, `by: captain`). Only the captain can override: auto-merge and "Merge when QA passes" never do.
