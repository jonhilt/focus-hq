# Fakes behave like the real thing

A third rule for the office's quality checks, beside [the two rules for state](invariants.md): **the fakes the tests rely on must behave like what they stand in for.** 12 of the [bug corpus](bug-corpus.md)'s 90 real fixes (kind `external`) were wrong assumptions about git, GitHub, the SDK or the shell: GitHub's pull request head lagging a push (57f3d0e), the mirror's local `main` never moving, so diffs against it were wrong (b0ac83c), a push refused over a branch GitHub had deleted (5e27b8e), an untracked `.idea/` counting as a change (b186a17), the SDK streaming `TaskUpdate`'s keys before repairing them (e230e21). Their tests passed because the fakes they ran on (`demoWorkspace`, the demo GitHub, `FakeClaude`) encode what the developer assumed, not what the real thing does.

So each interface the office fakes gets a **contract**: one suite of behavioural expectations, run against the real implementation and against each fake. Where they disagree, either the fake is fixed or the expectation is excused for that fake, with the reason, as a **simplification**. A simplified expectation is held to fail (`it.fails`): a fake that comes to keep it is told to drop the excuse.

## Git: `WorkspaceOps`

`server/agents/workspaceContract.ts` holds the contract, each expectation one scenario told through a `World` (the workspace, the agent committing, the base moving on GitHub, someone else pushing, GitHub deleting a merged branch). `workspaceContract.test.ts` runs it against `liveWorkspace` (`workspace.ts`) on throwaway repos, a bare repo as origin and the office's clone where `gh repo clone` would leave it, and against `demoWorkspace`. No network; about 8 s.

| expectation | taught by | git | demo |
| --- | --- | --- | --- |
| a new checkout starts at origin's base: nothing ahead, unshipped or uncommitted | | ✓ | always 2 ahead |
| HEAD stays put until a commit, which moves it | | ✓ | a new HEAD on every read |
| unshipped commits: those since the base, oldest first, less what shipped | | ✓ | 2 ahead, none unshipped |
| an untracked file is an uncommitted change, and a snapshot commits it | b186a17 | ✓ | no disk |
| a branch never pushed isn't on origin and counts from the base; once pushed, nothing is unpushed | | ✓ | always on origin |
| the base moving on origin is never the branch's own work | | ✓ | no disk |
| the local base follows origin's, so an agent's diff against `main` is only theirs | b0ac83c | ✓ | no disk |
| a squash-merged slice moves to fresh code carrying only what never shipped | | ✓ | no disk |
| commits that don't apply fail the cherry-pick, leaving HEAD as it was | | ✓ | always applies |
| renaming onto a taken branch fails | | ✓ | always works |
| a push lands after GitHub deleted the branch it last went to | 5e27b8e | ✓ | no origin |
| someone else's commits on origin's branch are noticed, and a pull brings them in | | ✓ | nobody else pushes |
| publishing creates the branch, or takes what a cloud session pushed, never overwriting it | | ✓ | no origin |
| merging the base: up to date, or merged and pushed | | ✓ | always conflicts |
| merging the base reports the conflicting files and pushes nothing | | ✓ | always `src/header.ts` |

The demo workspace keeps none of them: it touches no git at all, by design (the demo office has no checkouts, its agents always have something to ship, and its conflicting PR always needs an agent, to have something to watch). Each is excused with that reason. What it means: **no test that runs the manager on `demoWorkspace` (every `fakeOffice` test) can catch a wrong assumption about git.** Those bugs are caught only by tests on real git, which is what this contract adds for every `WorkspaceOps` method the manager decides on. Tests that need a workspace with state (the slices' check, `sliceInvariants.test.ts`) fake it themselves; a fake like that worth sharing should be run through this contract first.

## GitHub

Real GitHub isn't there offline, so `server/github/demoContract.test.ts` writes down, as tests of the demo GitHub, what it must keep of the real one: a pushed head GitHub hasn't caught up with (57f3d0e: the demo's never catches up with the office's pushes, so code trusting it shows), a merge refused once the head moved on (`--match-head-commit`), only open pull requests found from a branch, a pull request's comments read back (the verdict mark a restart looks for), merging or closing one that isn't open refused. Two the demo didn't keep, fixed: it opened a second pull request from a branch that had one open (GitHub refuses with 422), and called a pull request it hadn't got `CLOSED` (`gh pr view` fails), which would have closed the office's record of it. Still simplified: the demo never reports mergeability `UNKNOWN` (33dc5c2), never fails with a 5xx (5e27b8e), and has no branches for `--delete-branch` to delete.

A live check would run the same tests against `ghCliLayer`: it needs a sandbox repository the token can write to (pushing branches, opening, merging and closing pull requests), the git half to push to it, and polling with a deadline for what GitHub settles later (the head after a push, `UNKNOWN` mergeability). Run by hand or nightly, never in `pnpm test`.

## Did it catch the real bugs?

Each external fix's code was reversed onto today's (only its non-test changes), and the contracts run:

| fix | | caught |
| --- | --- | --- |
| 5e27b8e | push over a branch GitHub deleted (`fetch --prune` taken out) | ✓ the push fails with "stale info" |
| b0ac83c | the local base following origin's (`followOrigin` made to do nothing) | ✓ `main` in the checkout isn't origin's |
| b186a17 | untracked files making the scorecard's checkout dirty | ✗ the scorecard's own git, not `WorkspaceOps` (the agents' `hasUncommittedChanges` counts them, as it should) |
| 33dc5c2 | mergeability `UNKNOWN` | ✗ the demo never says it (simplified, above) |
| 35ab586, e230e21, 121f207, 63c062e, c7e7340 | the shell Claude Code runs Bash in, the SDK's stream, cloud sessions refused | ✗ no contract yet for `AgentRunner` |
| c82fc35, 1dc03e5, 9e6c672 | onnxruntime aborting on exit, the browser's voices | ✗ outside any faked interface |

So 2 of the 2 git bugs the contract covers. The next contract worth writing is `AgentRunner` (`FakeClaude`, `DemoRunner` against Claude Code's real stream), recorded from real sessions rather than run live.
