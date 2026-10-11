# CRAP scores

`pnpm run crap` scores every function in `server/` and `shared/` by how risky it is to change: its CRAP score (Change Risk Anti-Patterns, Savoia & Evans, 2007).

```
CRAP = complexity² × (1 − coverage)³ + complexity
```

- **complexity** is the function's cyclomatic complexity: 1, plus one for each `if`, loop, `case`, `catch`, `?:`, `&&`, `||`, `??`, `?.` and default parameter in its own body, counted as ESLint's `complexity` rule counts them. A nested function's branches count towards it, not its parent.
- **coverage** is the share of the function's own statements the unit tests run, from vitest's v8 coverage. A file no test loads has none.

A fully tested function scores its complexity; an untested one scores about its complexity squared. Above **30** a function is too complex for how little of it is tested: untested, that's complexity 6 and up; half covered, 12; 80% covered, 25; and past 31 no amount of testing brings it under. There are two ways down, and both make the next change cheaper: split it into small pure functions, or test it.

## Running it

| | |
| --- | --- |
| `pnpm run crap` | runs the unit tests with coverage (about 30 s), then prints how many functions are over 30, the spread of scores and the riskiest 10 |
| `pnpm run crap --top 25` | the riskiest 25 |
| `pnpm run crap --all` | `client/src/` and `scripts/` too. Most of the client is checked in the browser, not by unit tests, so it scores high: that's expected, not a to-do list |
| `pnpm run crap --changed [base]` | also lists what the branch touched since `base` (from where the branch left it, `main` by default): how many functions, their total CRAP, and each one over 30 |
| `pnpm run crap --coverage <file>` | scores from an existing `coverage-final.json` rather than running the tests |

The demo's fakes and scripts (`demo*.ts`) are left out unless you pass `--all`. It's advisory: it exits 0 whatever the scores.

## In review

Focus's QA runs `pnpm run crap --changed` on every pull request to this repo (CLAUDE.md asks them to) and reports it as an advisory check, **CRAP (advisory)**, on the PR: the functions it touched, their total and any over 30. It never fails a PR on its own. A new or worsened function over 30 gets a line in the summary saying how to bring it down, and may get a spot-check. QA, in every project, also looks for tests that run code without checking what it does.

## What it doesn't tell you

- Coverage says a line ran, not that a test checked what it did: a test with no assertions covers as well as a good one. Don't raise coverage for the score's sake.
- Cyclomatic complexity counts paths, not how hard the code is to read: a flat `switch` scores high and reads easily.
- It's per function, so it can't see coupling, duplication or naming.

The scoring is in `scripts/crapScore.ts` (pure, tested next to it); `scripts/crap.ts` runs the tests and prints the report.
