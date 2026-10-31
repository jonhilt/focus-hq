---
name: babysit-pr
description: Take one of the goal's pull requests to mergeable (failing checks, merge conflicts, QA's findings, review comments) and, only when the captain told you to merge it, have Ops merge it once QA passes it. Use it after QA fails a pull request, when its checks go red or it conflicts with its base, or when the captain asks you to get one merged.
---
# Babysit a pull request

Work in the pull request's repo folder (`cd <folder>`), on its branch. Go round the loop below until nothing is left to fix, then stop at mergeable, or merge it if you were told to.

## 1. Read where it stands

```
gh pr view <number> --json number,isDraft,headRefName,baseRefName,headRefOid,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
gh pr checks <number>
```

- `isDraft`: it isn't ready for review yet. Finish it, then `gh pr ready <number>` (see /ship-slice).
- A check failing: step 2.
- `mergeable` is `CONFLICTING`: step 3.
- QA failed it, or someone asked for changes: step 4.
- Checks still running: wait with `gh pr checks <number> --watch --interval 30`, or end your turn and come back to it.
- Not ready and green, no conflicts, nothing asked: it's mergeable. Go to step 5.

## 2. Fix a failing check

1. Find which check failed and why: `gh run view <run-id> --log-failed` (the run id is in `gh pr checks <number>`).
2. Reproduce it locally with the checks the repo's CLAUDE.md or README asks for, and fix the cause. Never skip, weaken or delete a check to make it pass.
3. If it's flaky and nothing in the pull request touches it, rerun it once: `gh run rerun <run-id> --failed`. If it fails again, it isn't flaky: fix it.
4. Commit, run the checks again, and `git push`.

## 3. Resolve a merge conflict

1. `git fetch origin`, then `git merge origin/<base>`. Merge, never rebase: QA and Ops follow the branch's commits, and a push must never be forced.
2. For each conflicting file, read what the base changed (`git log -p origin/<base> -- <file>`) and keep both intents. Where they can't both stand, say so to the captain rather than drop one.
3. Run the repo's checks, `git commit --no-edit`, and `git push`.

If Ops tells you it already merged the base and pushed, don't merge again: pull what it pushed with `git pull --no-rebase origin <branch>`. If `git push` is rejected because someone else pushed first, pull the same way and push again.

## 4. Answer QA and review comments

- QA's verdict comes to you as a note, and its report is a comment on the pull request: `gh pr view <number> --comments`. Fix each defect it found, and keep any failing proof test it left until it passes.
- Inline review comments: `gh api repos/<owner>/<repo>/pulls/<number>/comments`. Fix each, or say why not, and reply on its thread: `gh api repos/<owner>/<repo>/pulls/<number>/comments/<comment-id>/replies -f body='<what you did>'`.
- A finding that's really the captain's call (scope, a trade-off) goes to them. Don't decide it yourself.

Push the fixes to the same branch. QA tests it again, and you hear the verdict.

## 5. Mergeable: stop, or merge

- If the captain told you to merge it, call `mcp__office__merge_when_passed` with the repo and number. Ops merges it once QA passes it, at exactly the commit QA passed, and you hear when it lands. A fail drops the request: fix it (step 4), and ask again.
- Otherwise stop here. Tell the captain it's mergeable: its lane decides from there, and in ask the captain merges it.

Never merge or approve it yourself with `gh` (Ops refuses both), and never use `merge_when_passed` without the captain's word.
