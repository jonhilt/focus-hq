# QA scores

How good QA's real work is, measured. A model grades some of QA's reports against the diff each one reviewed (thorough, shallow or wrong, as `.focus/scorers/qa-report.md` says), and each grade is a `qa-score` line in the ledger, stamped with the QA prompt, model and effort behind the report. So a change to QA (its `qa.md`, its model) can be judged by how its real reports score after it, beside the benchmarks (`.focus/benchmarks/`), which measure it on bugs with a known answer.

`FOCUS_PLUGINS=qa-scores`.

## Where it lives

- `scoringRules.ts`: which reports are graded (`reportsDue`, `sampled`).
- `scoring.ts`: what the model is told of each (`scorePrompt`, `scoreSchema`), and the line its grade is written as (`scoreEntry`).
- `server.ts`: sweeps QA's review journals an hour apart (and five minutes after Focus starts), reads each report's diff from Focus's clone of its repo, asks the model, and writes the line; `POST /sweep` sweeps now.
- `.focus/scorers/qa-report.md`: the rubric the model is told, and the scale: its labels and their scores, the score that passes, how many in every hundred reports are graded, and the model.

## Why it's built this way

- **The ledger is what's been graded.** Each report the sample takes is graded once (`invariants.test.ts`): a sweep leaves out every report a `qa-score` line has graded, and one sweep runs at a time. Nothing else is saved, so a grade still out when Focus stops is lost, and the next sweep after it starts again grades the report.
- **A sample, picked by a hash.** Which reports are graded is a hash of each (its pull request and the commit QA tested), so the same ones always are, and the rate is the scorer file's. A sweep looks back a week, so reports from while Focus was down or the plugin was off are graded once it's back, and grades at most a dozen, so a backlog is spread over hours rather than paid for at once.
- **QA's own report and the diff it reviewed.** The report is the one QA's verdict was journaled with (`reported` in the review journal), with how it accounted for each changed file, and the diff is the pull request's base to the commit QA tested, as QA diffed it, cut past 60,000 characters. The grade carries the stamp QA's verdict had, so it's the prompt that made the report that's scored, even after `qa.md` has changed.
- **Haiku, and why.** A probe on 24 Oct graded five of QA's recent reports thorough, a report cut down to "the tests pass" shallow, and a pass beside a diff with an inverted guard planted in it wrong, naming the line. Each grade cost 3 to 10 cents (Claude Code's overhead on each call, and the diff) and took about a minute. Its first real sweep graded 12 of that week's reports, across two projects' repos, in 14 minutes for $1.05: 11 thorough, and one shallow, a pass whose integration tests couldn't run there.
- **A report it can't grade is passed over.** No diff to be had (the commit gone from the clone and from GitHub), or an answer with no label of the scorer's: tried again on the next sweep, twice in all until Focus starts again.
