# Merging and the merge check

Every time the office merges a pull request, it runs the **merge check** first. The check builds what the base branch would look like with the PR in it (the PR's head merged onto the base as it is right now) and runs the repo's checks on that. If the merge conflicts or a check fails, the office doesn't merge.

The reason is that a PR can be green on its own branch and still break main once it lands next to someone else's work. Before the check existed, the office's history had 5 QA fails on PRs that only broke main after being merged with others, 4 on PRs that claimed green but weren't, and 9 bug fixes for parallel agents' work colliding. Nothing automatic ran before a merge.

## Where the office merges

Every merge goes through `Office.mergePullRequest` (`server/office.ts`), which hands it to the manager's `Merges` part (`server/agents/manager/merges.ts`). That part runs the check and then calls GitHub's merge. Three things lead there:

- **The captain's merge button** on the board or the Tricorder (`POST /api/prs/merge`, `Office.mergeFromBoard`).
- **Merge when QA passes** ([QA](qa.md)), once QA passes the PR (`requestedMerges`).
- **Auto-merge** ([QA](qa.md)), when `mergeStep` says merge (`followMergeStep`).

PRs merged on GitHub itself don't go through the office, so the check never sees them.

## How the merge is built and checked

1. **Fetch** (`mergeHeads` in `server/agents/workspace.ts`). Into the office's clone of the repo (`data/repos/<owner>__<name>`), the office fetches the base branch and `refs/pull/<n>/head`, then reads their two commits: `base` and `head`.
2. **Decide** (`gateStep` in `shared/mergeCheck.ts`, pure). If the caller named the commit it means to merge (QA's pass, for example) and the PR has moved on since, the merge is refused. If the PR already has a trial for this exact `base` and `head`, that trial's verdict stands and nothing runs again. Otherwise the office tries the merge.
3. **Merge** (`tryMerge`). `git merge-tree --write-tree` merges `head` onto `base` inside the clone, with no checkout and no push. If it conflicts, the conflicted files are the result. Otherwise `git commit-tree` makes a merge commit that sits on no branch.
4. **Check**. The merge commit is checked out in the repo's checks folder (`data/checks/<owner>__<name>`). This is the same reused folder QA's carried-over checks use, so installed dependencies survive between runs. The office installs from the lockfile and runs the merge checks, stopping at the first one that fails.
5. **Verdict** (`mergeVerdict`, pure). The PR merges only if git merged it by itself and every check passed (a repo with no checks to run counts as passing). Conflicts, a failing check, or a merge the office couldn't build or run all refuse it.
6. **Merge on GitHub**. The office merges exactly the head it checked (`--match-head-commit`), using the repo's [merge method](configuration.md#merge-method).

Merges in one repo go one at a time. A merge asked for while another in the same repo is still going waits its turn, and shows that straight away: its card reads **queued behind #N** (the PR just ahead of it), its button **Queued behind #N**, and a toast says so. When its turn comes the card flips to **checking the merge**. That way each check runs against a base that already has the previous merge in it, which is the case the check exists for. If a merge lands on GitHub in the gap between the check and the office's own merge, the check doesn't see it.

## Which checks

- By default the check runs the repo's `typecheck`, `lint` and `test` package.json scripts, whichever of them it has (`mergeCheckScripts`), using the package manager its lockfile names.
- **A repo can say exactly what to run**: if its package.json has a `merge-check` script, the office runs that script and nothing else.
- **A project can choose different scripts** with `mergeChecks` on the project (`PATCH /api/projects/:id` with `{ "mergeChecks": ["typecheck", "test:unit"] }`, or a comma-separated string). An empty list runs no checks, so only conflicts stop a merge. `null` goes back to the default.
- A repo with no package.json, or none of the chosen scripts, runs no checks. Only conflicts stop its merges.

## While it runs, and when it refuses

- The office doesn't wait on the check. The board's refresh and the captain's request both return straight away. The PR's card shows **checking the merge**, its merge button reads **Checking the merge…**, and a toast says the check has started.
- When it refuses, the card shows **merge refused: why** (for example, "`pnpm run lint` fails on its merge with the base at 1a2b3c4"). A toast says the same, and a comment on the PR lists each command with ✅ or ❌ and the end of the failing one's output. With auto-merge, the refusal blocks that head commit until something new is pushed (`stepMark`). A "Merge when QA passes" request is dropped.
- **Caching**: each PR's last trial is kept by `base` and `head`. Trying again runs nothing until main moves or the PR gets a new push. A trial that couldn't run isn't kept, so it runs again next time. The cache lives in memory and is cleared when the office restarts.
- **The ledger** gets a `merge-check` line for every trial that runs (`passed`, `failed`, `conflicts` or `broken`), with the commits it checked and what failed. These lines appear under **Merged** in the ledger review.

## Merging past it (the override)

If the check refused a PR, its merge button becomes **Merge anyway**. A confirm says why the check refused and that the ledger will note the override. Confirming merges the head the captain saw, with no check. The ledger gets a `merge-check` line with outcome `overridden` and `by: captain`. Only the captain can override: auto-merge and "Merge when QA passes" never do.
