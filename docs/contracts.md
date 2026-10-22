# Fakes behave like the real thing

A third rule for Focus's quality checks, beside [the two rules for state](invariants.md): **the fakes the tests rely on must behave like what they stand in for.** In the [bug corpus](bug-corpus.md) as of 2026-10-16, 12 of the 90 real fixes (kind `external`) were wrong assumptions about git, GitHub, the SDK or the shell: GitHub's pull request head lagging a push (57f3d0e), the mirror's local `main` never moving, so diffs against it were wrong (b0ac83c), a push refused over a branch GitHub had deleted (5e27b8e), an untracked `.idea/` counting as a change (b186a17), the SDK streaming `TaskUpdate`'s keys before repairing them (e230e21). Their tests passed because the fakes they ran on (`demoWorkspace`, the demo GitHub, `FakeClaude`) encode what the developer assumed, not what the real thing does.

So each interface Focus fakes gets a **contract**: one suite of behavioural expectations, run against the real implementation and against each fake. Where they disagree, either the fake is fixed or the expectation is excused for that fake, with the reason, as a **simplification**. A simplified expectation is held to fail (`it.fails`): a fake that comes to keep it is told to drop the excuse.

## Git: `WorkspaceOps`

`server/agents/workspaceContract.ts` holds the contract, each expectation one scenario told through a `World` (the workspace, the agent committing, the base moving on GitHub, someone else pushing, GitHub deleting a merged branch). `workspaceContract.test.ts` runs it against `liveWorkspace` (`workspace.ts`) on throwaway repos, a bare repo as origin and Ops' clone where `gh repo clone` would leave it, and against `demoWorkspace`. No network.

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

The demo workspace keeps none of them: it touches no git at all, by design (the demo ship has no checkouts, its agents always have something to ship, and its conflicting PR always needs an agent, to have something to watch). Each is excused with that reason. What it means: **no test that runs the manager on `demoWorkspace` (every `fakeFocus` test) can catch a wrong assumption about git.** Those bugs are caught only by tests on real git, which is what this contract adds for every `WorkspaceOps` method the manager decides on. Tests that need a workspace with state (the slices' check, `sliceInvariants.test.ts`) fake it themselves; a fake like that worth sharing should be run through this contract first.

## GitHub

Real GitHub isn't there offline, so `server/github/demoContract.test.ts` writes down, as tests of the demo GitHub, what it must keep of the real one: a pushed head GitHub hasn't caught up with (57f3d0e: the demo's never catches up with Ops' pushes, so code trusting it shows), a merge refused once the head moved on (`--match-head-commit`), only open pull requests found from a branch, a pull request's comments read back (the verdict mark a restart looks for), its description kept as it opened and as it was edited (the recap Ops puts in place on each ship), merging or closing one that isn't open refused. Two the demo didn't keep, fixed: it opened a second pull request from a branch that had one open (GitHub refuses with 422), and called a pull request it hadn't got `CLOSED` (`gh pr view` fails), which would have closed Ops' record of it. Still simplified: the demo never reports mergeability `UNKNOWN` (33dc5c2), never fails with a 5xx (5e27b8e), and has no branches for `--delete-branch` to delete.

A live check would run the same tests against `ghCliLayer`: it needs a sandbox repository the token can write to (pushing branches, opening, merging and closing pull requests), the git half to push to it, and polling with a deadline for what GitHub settles later (the head after a push, `UNKNOWN` mergeability). Run by hand or nightly, never in `pnpm test`.

## Claude Code: the SDK's stream

`server/agents/claudeContract.ts` holds what Focus relies on Claude Code saying down the SDK's `query`, each expectation read from one of three sessions as Claude Code and Focus played it out, beat by beat. `claudeContract.test.ts` holds it against what real Claude Code said and against the session's stand-in (`claudeStandIn.ts`, which `claudeRunnerInvariants.test.ts` runs on). No network.

The real side comes first from what's on disk, read only. Focus's logs are rendered lines, not messages. Claude Code's transcripts (`~/.claude/projects/*.jsonl`) keep the turns, tool calls and results, and Claude Code's queue (`queue-operation`: a message or a task's report enqueued, then taken in a turn of its own or folded into the one under way), but none of the SDK's own messages: no `result`, no background list, no `task_started`. Those were recorded live: `pnpm run claude-streams` (`tools/claudeStreams.ts`, behind `FOCUS_LIVE_CLAUDE=1`, never in `pnpm test`) runs three tiny scripted sessions on Haiku and keeps only the messages' shapes (`shapeOf`: kinds, flags, tool names, ids made up), a few cents each. The contract's real sessions (`REAL`) are those recordings, from Claude Code 2.1.289, with every id and word made up. Claude Code's own schema for the SDK's messages (in its bundle) says the rest: the background list is every live background task after a change, replaces the last, is sent whenever which tasks run changes and never at startup, and comes before a task's own start and end "in practice", the order otherwise unspecified.

| expectation | taught by | real (recorded) | stand-in |
| --- | --- | --- | --- |
| every turn opens with `init` | | ✓ | ✓ (it opened only the first: fixed) |
| a message sent mid-turn is folded into it: the turn ends counting nothing queued, and no turn of its own follows | | ✓ (in the transcripts, some sent during a turn got one of their own) | ✓ (it could only queue one for the next turn: it can now fold, an action the session's checks pick among) |
| a message sent as the turn ends gets a turn of its own, though the ending turn counted nothing queued | the race found on main | ✓ | ✓ |
| the background list comes before a task's own start and end, and already says it | | ✓ | ✓ (it came after: fixed) |
| a running workflow is in every background list from its start to its end | eab2be2 | ✓ | ✓ |
| a task that ends while no turn is under way is taken in a turn of Claude Code's own | 879f9ec | ✓ (in the transcripts, a few were never taken, each as its session ended) | ✓ |
| a task that ends during a turn is folded into it | | ✓ | ✓ (it could only queue it: it can now fold) |
| with Focus's input closed, a report still gets its turn, and a tool needing approval there fails without asking | 879f9ec | ✓ failing with "Tool permission request failed: AbortError: Stream closed"; the transcripts show tools cancelled with "The user doesn't want to take this action right now" | ✓ (it counted them: it now shows the call and its failed result) |
| Claude Code exits once Focus's input has closed, with no turn under way and nothing running | | ✓ | ✓ |
| a background command's start says it's in the background, and names the tool call that started it | | ✓ | ✓ |

A level up, the test plays each real session's messages to Focus's runner (`ClaudeRunner`), which keeps listening until the last turn is over in all three, including the one where the recording closed its input as the turn ended with a command running (879f9ec put back): the runner, unlike the recording, listened on through the report's turn. `FakeClaude` and `DemoRunner` stand in for the runner and Claude Code together and say nothing at the SDK's `query`, so only what the runner does can be held against them: `FakeClaude` takes a message whatever (`send` never refuses: excused, its turns end when the test says), and can't stop a task once deaf, as the runner can't once its input has closed. `DemoRunner` isn't held.

Beyond the contract, the stand-in plays what no recording shows, for the session's checks to reach, with a plain check that it still can: a background list that leaves out a workflow still running (eab2be2's report). On 2.1.289 neither the recording nor Claude Code's own code shows one (the list holds every task running or pending that isn't held in the foreground, workflows included), so how eab2be2's list came to leave its workflow out is unknown. Focus counts the workflows it saw start whatever the list says (`runningInBackground`). What the stand-in assumes beyond all this is under [What it can't tell](invariants.md#what-it-cant-tell).

## Did it catch the real bugs?

Each external fix's code was reversed onto the code of the day (only its non-test changes), and the contracts run (as of 2026-10):

| fix | | caught |
| --- | --- | --- |
| 5e27b8e | push over a branch GitHub deleted (`fetch --prune` taken out) | ✓ the push fails with "stale info" |
| b0ac83c | the local base following origin's (`followOrigin` made to do nothing) | ✓ `main` in the checkout isn't origin's |
| b186a17 | untracked files making the scorecard's checkout dirty | ✗ the scorecard's own git, not `WorkspaceOps` (the agents' `hasUncommittedChanges` counts them, as it should) |
| 33dc5c2 | mergeability `UNKNOWN` | ✗ the demo never says it (simplified, above) |
| 35ab586, e230e21, 121f207, 63c062e, c7e7340 | the shell Claude Code runs Bash in, a tool's input as the SDK streams it, cloud sessions refused | ✗ the Claude Code contract holds the stream's turns and background tasks, not these |
| eab2be2 | a workflow Focus saw start, left out of the background list | ✗ no recording shows a list leaving one out; the stand-in plays it, and the session's promise and reach test catch it ([invariants](invariants.md#does-it-catch-real-bugs)) |
| c82fc35, 1dc03e5, 9e6c672 | onnxruntime aborting on exit, the browser's voices | ✗ outside any faked interface |

So 2 of the 2 git bugs the contract covers. The Claude Code contract covers the stream's turns and background tasks; the shell, a tool's input as it streams and cloud sessions are still outside it.
