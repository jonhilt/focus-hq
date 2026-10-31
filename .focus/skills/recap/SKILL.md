---
name: recap
description: Write a pull request's system recap and pick the lane it merges in, then put it on with mcp__office__recap. Use once one of the goal's pull requests is ready and could merge in a lower lane than ask, when it has changed enough that its recap no longer fits, or after Ops refuses a recap.
---
# Recap a pull request

A system recap tells the captain what a pull request does to the system before they read its diff, and it sets the lane the pull request merges in once QA passes it. Without one, it waits in ask for the captain.

## 1. List what it changes

```
git -C <folder> fetch origin
git -C <folder> diff --name-only origin/<base>...HEAD
```

Every one of these files has to fall under some primitive's paths, written from the workspace root with the repo folder first (`focus/server/agents/skills.ts`, or a folder ending in `/`). That includes tests, docs and baselines.

## 2. Name the primitives

A primitive is a building block of the system, the kind someone names when explaining how it works (the merge gate, the push guard, the lead's prompt), not a file. Group the changed files under them, riskiest first.

- `id`: short, lowercase with dashes, and the same from slice to slice. Before you make one up, reuse the ids in the goal's earlier recaps (they're in each pull request's description: `gh pr view <number> --json body`).
- `impact`: `composes` if it's used as it is (wiring, a call site), `extends` if its behaviour or contract changed, `adds` if it's new. Say what it really is: the riskiest impact sets the lowest lane.
- `change`: what the slice does to it, in a line.

## 3. Map, flow and invariants

- `map`: arrows between the primitives, and anything they talk to (`user`, `github`), each labelled with what passes along it. Ops checks each arrow against the code's imports and marks the ones it can't back.
- `flow`: what happens, in order, as messages from one to another.
- `invariants`: the promises the slice could break, in plain words.

## 4. Pick the lane

The rollup, the riskiest impact, sets the lowest lane you may pick: composes → ship, extends → show, adds → ask. Above that floor, pick by how much the captain would want to see it first. The chief of staff reads the recap after you, by the same rules, and can raise the lane but never lower it:

- **ask**, when the slice changes what the captain sees or does in a way they haven't plainly asked for; touches money, permissions, secrets, security, production data, or anything outward-facing; changes what agents may do by themselves; or deletes, migrates or rewrites stored data, or changes a format other things read.
- **show**, when it's safe to merge but the captain would want to know it landed: a visible change they asked for, or a fix to something they reported.
- **ship**, otherwise. When you're unsure, go higher.

## 5. Put it on

Call `mcp__office__recap` with the repo, the pull request's number and the recap. Ops refuses one that leaves a changed file under no primitive's paths, or picks a lane below the rollup's, and says exactly what to fix: fix that and call again. A lane raised before stays raised. Send the recap again whenever the pull request changes enough to need it: the new one replaces the old.
