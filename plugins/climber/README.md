# The climber

A plugin (`FOCUS_PLUGINS=climber`, [plugins](../../docs/plugins.md)).

Main engineering's climber, Lt. Rhee, takes the [scorecard](../scorecard/README.md)'s worst gap in Focus's own repo and fixes it, or sweeps one kind of fix across several places at once. Each climb is one pull request with the numbers measured before and after. You approve each one. It's a hill-climb, after [ratstack's hill-climb prompt](https://ratstack.sh/prompts/hill-climb):

1. measure;
2. take the top gap;
3. fix it;
4. prove the fix with the same numbers;
5. ship it;
6. go again.

The climber requires the [scorecard](../scorecard/README.md) plugin: switch both on with `FOCUS_PLUGINS=scorecard,climber`. Without the scorecard the climber is left out, saying why in Focus's log, since its whole job is moving the scorecard's numbers and main's history only grows while the scorecard measures each merge.

## Keep climbing

- **One climb at a time.** With climbing on and no climb open, a climb starts. The next starts only once you merge or close the last one's pull request.
- **When climbing switches itself off.** A climb that ends without a pull request switches climbing off and says why. That's a climber who found nothing worth changing, one who failed, or one sent home before shipping.
- **Switching it off.** It stops new climbs. A climb already under way carries on to its pull request.

## One engineer

Every climb is Lt. Rhee's: one crew member owns the hill, rather than a new hire each time, but each climb is a fresh Claude Code session on a new branch, starting clean.

They're not the chief engineer, Lt. Brennan: Brennan's retros (the retro plugin) only read the code and draft issues, and the climber is who changes it, taking those issues as gaps. The climber reads the retro's issues and frictions from the ledger, so it doesn't need the retro plugin on.

## A climb

- **What they've climbed before** (see [Memory](#memory)): merged ones aren't redone, and a gap you turned down isn't taken again unless their hypothesis says what's changed.
- **Measure.** They run `pnpm run scorecard --no-save` before changing anything; those numbers are the Before. A gain only counts past the [noise floor](../scorecard/README.md#noise-floor). A time is measured interleaved (base and change taking turns, medians compared), since the machine's load swings it far more than any one change.
- **Shortlist.** Before choosing, the strongest gaps as a scored table. Writing the scores down makes the pick a rule the next climb can check, rather than one session's feel (three fresh sessions on one brief once picked three different gaps).
- **Sweeps.** A kind of fix with several places goes on the shortlist as one row, a sweep, never one place at a time, since each pull request carries the same fixed cost (two scorecards, QA, your merge) and a sweep spreads it over several places.
- **Hypothesis.** Before changing anything: which gap, the number it will move and by how much, and what would show them wrong, ending in a `Target: <metric key> <before> → <after>` line.
- **Sign-off.** Anything that needs your sign-off (a dependency version, how Ops merges or deploys) is listed, not done.
- **Fix.** A check first when the bad pattern can come back, then the smallest change. A planted bug proves each new test can fail.
- **Prove.** The [ratchets](../scorecard/README.md#the-ratchets)' baselines lowered to the gain, then the scorecard again; those numbers are the After. It runs the whole gate itself, so the climber doesn't run the gate first and pay for it twice.
- **Never:** `--no-verify`, loosening a rule or test, changing a dependency version, or two reasons in one pull request (a sweep is one reason: the same fix in each place).
- **QA and merging.** QA reviews it like any pull request Ops opened, and a fail goes back to the climber. It **never merges by itself**, whatever auto-merge says: the merge gate blocks any `focus/climb-` branch with "only the captain merges it" (`captainMerges` in `shared/mergeGate.ts`). The branch prefix keeps that true after the climber has gone home and after a restart. **Merge when QA passes** still works, since that's you saying so.

## Memory

Each climb starts a fresh session, so what Lt. Rhee knows of the climbs before comes from the brief, built from the raw record each time rather than from a summary Ops keeps: the `focus/climb-` pull requests on GitHub, the climbs that ended without one, and whether main has held each merged climb's gain.

To turn a climb down so the next one learns from it, close its pull request with a comment saying why. GitHub failing costs the climb its log, not the climb.

### Replay

`pnpm run climb:replay` tests the memory with an experiment rather than by reading the brief. Fresh read-only sessions do the brief's first steps from a measured scorecard (the latest saved, or `--card`), changing nothing, and answer with their scored shortlist and the one they'd take:

- the **control** gets the log as it is; its first session's pick becomes the rejected gap;
- the **treatment** gets the same log with that pick planted as a climb you closed, with a reason;
- a judge (`--judge`, Haiku by default) finds the rejected gap on each session's shortlist, if it's there.

It's **remembered** when the rejected gap is a real contender (the control's other sessions list it too) and no treatment session takes it; **repeated** when the treatment takes it at least as often as the control; otherwise **inconclusive** (try `--runs 5`). It also counts how many sessions took the top of their own shortlist by the scoring rule. Each run is saved in `~/.focus/plugins/climber/` with every shortlist and judgement and what it cost. It runs real sessions, so it's by hand, not in the gate.
