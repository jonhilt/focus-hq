---
name: ship-slice
description: Ship a slice of the goal as pull requests, with the exact git and gh commands. Use it to open a pull request as a draft, mark it ready for QA, push a fix, or start the next slice after one lands.
---
# Ship a slice

A slice is a piece of work that can be reviewed and merged on its own: one pull request in each repo it touches. Run every command in that repo's folder (`git -C <folder> …`, or `cd <folder>` first for gh).

## Open it as a draft

1. Commit as you go, and run the checks the repo's CLAUDE.md or README asks for before you push.
2. Push the branch: `git push -u origin HEAD`.
3. Open the pull request as a draft: `gh pr create --draft --base <base> --title "<title>" --body-file <file>`. Say in the body what changes and why, and how you checked it, and end it with the attribution your instructions give.

Ops follows every pull request from a branch your checkouts have been on as the goal's, so there is nothing else to register.

## Mark it ready

When the slice is done and its checks pass:

1. `gh pr ready <number>`. QA reviews it now, and you hear its verdict.
2. If it's safe to merge in a lower lane than ask, put a system recap on it with `mcp__office__recap`.

## Push a fix

Push fixes to the same branch with `git push`; QA tests it again.

When Ops tells you it pushed to your branch (a fixer's commits, or the base merged in to settle conflicts), pull before you touch that folder again: `git -C <folder> pull --no-rebase origin <branch>`. Until you do, Ops won't ship that repo.

## Start the next slice

Never push a base branch, or a branch whose pull request has merged: Ops refuses both. Once a slice has landed, start the next one from the base on a fresh branch that tracks nothing, so a stray `git push` can't land on the base:

```
git -C <folder> fetch origin
git -C <folder> switch --no-track -c <new-branch> origin/<base>
```

The user decides what merges. Never merge or approve a pull request yourself.
