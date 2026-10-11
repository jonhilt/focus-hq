# QA

Every holodeck has a QA officer in blue, sitting at a station in the control ring facing the board, with a display you can look at over their shoulder.

- **When they test:**
  - Automatically, when the office opens a PR or pushes new commits to one. Turn this off per project at the QA station.
  - Whenever you press **Send to QA** (or **Re-test**) on a PR on the board, a teammate's PR included.
- **One at a time, per reviewer:** reviews queue up for the holodeck's officer. A goal's pull requests go instead to the goal's own reviewer, who sits at your left hand in the briefing room, across from its lead (and is listed at the QA station), so the holodeck's goals are reviewed side by side. Each goal's reviewer is the same person from review to review, and goes home with the goal; a review they were on, or still waiting for them, goes to the holodeck's officer. QA counts towards **Agents working at once**, but goes ahead of new issues in the queue and doesn't take one of the holodeck's agent slots.
- **How hard they think:** set at the QA station, for the officer and every goal's reviewer alike, from the next review (the model's default to begin with).
- **Which model:** **Model for QA** in the manager's Settings tab, for every room's officer and every goal's reviewer, from their next review: reviewing is lighter work than building, so a cheaper model like `claude-sonnet-5-5` often does while developers and leads stay on the office's **Model**. Empty means the office's **Model**. It's stamped on the reviewer each time they sit down to a review.
- **What they do:**
  1. Check the PR's head out, detached, into their own folder.
  2. Read the PR and its linked issues, and work out the acceptance criteria.
  3. Review the diff against the base branch, including whether new tests check what the code does or only run it (tests like that raise coverage but catch nothing).
  4. Run the tests, type checks, linters and build.
  5. Click through UI changes with the browser tool, so you see that on their station's display.
  6. Finish with a structured report: a verdict, a summary, every check made, the commands run, up to three **spot-checks** and, on a fail, fix instructions.
- **The report:** the office posts it as a comment on the PR (QA never touches GitHub themselves), and the board shows **QA passed**, **QA failed** or, once newer commits land, **QA passed an older commit**. Merging a PR whose latest commit QA hasn't passed asks you to confirm, and says why.
- **Spot-checks:** you rarely read a whole diff, so QA picks up to three places in it most worth your own eyes, riskiest first (a new route or permission, a changed guard, a weakened test, data that could be lost), each with its file, line and what could go wrong there (`SPOT_CHECKS` in `server/agents/qa.ts`). They're listed under **Worth a human look** on the PR comment and in the QA panel, and on a goal's pull requests they go on its chart, where you tick them off. Each links straight to its file and line in the pull request's changed files on GitHub: the office works out GitHub's anchor for it as it reads the report (`diffAnchor`: `diff-`, the SHA-256 of the file's path, then `R` and the line).
- **Screenshots:** the last 8 screenshots QA takes on purpose (`mcp__browser__screenshot`) go with the report, each with QA's caption. The office commits them to an orphan branch in the PR's repo, `focus-qa-evidence` (created on first use, no shared history with the code, never merged), and embeds them in the comment. A screenshot that fails to upload is left out of the comment and the error shows in QA's terminal.
- **The QA station** (<kbd>E</kbd> on the officer when they're free, or the QA chip on a PR):
  - **Reports**: every report in full, with its screenshots;
  - **Settings**: the auto-QA, send-back and auto-merge switches, how hard QA thinks, and the project's **QA brief**: what to check on every PR of this project ("works at phone width", "no console errors"). It goes into the officer's instructions on every review.
- **Sending a failed PR back:** when QA fails a PR the office opened, the office hands QA's summary and fix instructions to the developer who opened it. If they've gone home, a new agent sits down on the PR's branch, fixes it and pushes to the same PR. The fix goes back to QA by itself, and the re-test is told last round's findings (its summary, every failed or skipped check with its details, and the fix instructions) and the commit it tested, so it checks those first, then what changed since, plus a quick smoke test.
  - After 3 failed rounds, or a fix that pushes nothing, the PR is stuck. See [Stuck PRs](#stuck-prs).
  - Teammates' PRs are never sent back. Turn send-back off per project at the QA station.
- **Auto-merge** (off by default; switch it on per project at the QA station or on the project's card in the ready room): on each board refresh the office takes every PR it opened one step closer to merged, following `mergeStep` in `shared/mergeGate.ts`.
  - QA passed the PR's current head commit, its checks pass (or it has none) and it merges cleanly: it merges with the repo's merge method ([Configuration → Merge method](configuration.md#merge-method)), for that exact commit only (`--match-head-commit`), and its developer packs up.
  - Commits arrived after QA's verdict: back to QA first.
  - Checks fail: the failed GitHub Actions runs are re-run once (`gh run rerun --failed`). If they fail again, the PR goes back to its developer with the failing checks' names and links, like a QA fail.
  - Conflicts: **Resolve conflicts**, then QA again.
  - A refused merge (required reviews, say) shows GitHub's reason and isn't retried for that commit. Teammates' PRs never merge by themselves.
- **Merge when QA passes:** while QA is queued or testing a PR, its merge button becomes **Merge when QA passes** (any PR, a teammate's too, auto-merge on or off). The office remembers the request with the review and, once QA passes, merges exactly the commit QA passed (`requestedMerge` in `shared/mergeGate.ts`); if QA fails it, can't finish, or GitHub refuses, it tells you and forgets the request. Commits that arrive after the pass go back to QA first. Press the button again to take the request back. Merging a PR QA failed or hasn't tested still works, after a confirm.
- **Following up:** message the QA officer like any agent, to have them look at something else. Once their PR has merged or closed, their session is over: a message gets "PR #n was merged; nothing to review" instead of resuming it.

## Stuck PRs

Before a stuck PR reaches you, the holodeck's operations officer (the one at the **Ops** station) looks at it. The PR card says **Lt. … is looking**, and so does their speech bubble.

- **What they read:** QA's last two reports, GitHub's checks, the diff, the linked issue and a checkout of the PR. It's the same kind of read-only session as their drafting (`Read`, `Glob`, `Grep`, `dontAsk`).
- **What they do, exactly one of:**
  - **retry QA**, when QA's own session went wrong or the fix has landed since. QA gets their note.
  - **send back** to a developer, with a note on what to do differently.
  - **re-run checks**, when a red GitHub check looks flaky or like an outage. The failed Actions jobs re-run, then QA tests again.
  - **close the PR**, when the approach can't work. Its issue stays open and the board marks it (**PR #… closed**). The next agent assigned to it hears why.
  - **escalate** to you, with a one-line diagnosis.
- Afterwards the card says what they did. Only an escalation, or a session that ends without a decision, shows **QA failed: needs you** with a toast.
- **Limit:** each PR gets 2 triages. If it gets stuck a third time, it comes straight to you.
