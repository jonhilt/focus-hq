# Contributing to Focus

Issues and pull requests are welcome here.

Focus is built in a private repo, and this one is a copy of its `main`: its pull requests are never merged here. When yours is ready for review it's brought into the private repo as a branch of its own, reviewed and tested there, and merged with your commits as they are. They arrive back here on `main` within a minute or two, and GitHub then shows your pull request as merged, with your name on the commits.

So:

- Branch from an up-to-date `main`, and keep a pull request to one change.
- Before you open it: `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run crap --ratchet` and `pnpm run rules --ratchet` (see [CLAUDE.md](CLAUDE.md) for what they guard).
- Push more commits to the same pull request to answer review; don't force-push over commits that were already reviewed.
- By contributing you agree your work is released under the [MIT licence](LICENSE).

## Bringing a pull request in (maintainers)

In the private repo, after reading the pull request's diff (its code runs in CI and QA from then on): **Actions → Import contribution → Run workflow**, with the public pull request's number. That pushes it as `contrib/pr-<n>` and opens a pull request for it. Run it again after the contributor pushes more. Merge it with a **merge commit**, not a squash, so the public pull request closes as merged.

GitHub's own token can't push a branch that changes `.github/workflows`; bring one of those in by hand:

```bash
git fetch https://github.com/<public repo>.git pull/<n>/head:contrib/pr-<n>
git push origin contrib/pr-<n>
```
