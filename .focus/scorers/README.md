# The scorers

How a model grades a crew role's real work, one file a scorer: `<name>.md`. Where a benchmark (`.focus/benchmarks/`)
measures a role on tasks with a known answer, a scorer grades the work it really did, as it did it, so a change to a
role can be judged by both. The code that runs a scorer (`qa-report.md` is the QA scores plugin's) decides what it's
shown of each piece of work; the file says how it's graded.

A file is YAML frontmatter between `---` lines, then the rubric the model is told:

- `description`: what it grades, in a line.
- `role`: the crew role whose work it grades.
- `model`: the model that grades.
- `samplingRate`: how many in every hundred pieces of work it grades, picked by a hash of each, so always the same ones.
- `labels`: each label the model may give, and the score it's worth, from 0 to 1. The model is held to these.
- `passingScore`: the score work passes at.
- `maxTurns`, `timeout` (`90s`, `3m`): the model's session.

Each grade is written with the scorer's name and a digest of its rubric and scale (`qa-report-<digest>`), so grades from
before a change to either are told apart from grades after it; a change of model or rate keeps the digest, and the model
is written beside it. A field nothing reads, a wrong value or an empty rubric is refused as the file's read, naming its
file and line.
