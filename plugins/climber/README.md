# The climber

A plugin (`FOCUS_PLUGINS=climber`, [plugins](../../docs/plugins.md)).

Main engineering's climber, Lt. Rhee, takes the [scorecard](../scorecard/README.md)'s worst gap in Focus's own repo and fixes it. Each fix is one pull request with the numbers measured before and after. You approve each one. It's a hill-climb, after [ratstack's hill-climb prompt](https://ratstack.sh/prompts/hill-climb):

1. measure;
2. take the top gap;
3. fix it;
4. prove the fix with the same numbers;
5. ship it;
6. go again.

## Keep climbing

The **Climber** card on the engineering panel's overview (<kbd>E</kbd> at Lt. Brennan's station on deck 5) has the **Keep climbing** switch. It's off to begin with.

- **What it climbs.** It climbs the project that holds the office's own repo, which the office finds from its checkout's `origin` remote. The demo office has no repo of its own, so it climbs its first project's first repo. With no project holding the repo, the switch says to connect it first.
- **One climb at a time.** With the switch on and no climb open, a climb starts. The next starts only once you merge or close the last one's pull request.
- **When climbing switches itself off.** A climb that ends without a pull request switches climbing off and says why on the card. That's a climber who found nothing worth changing, one who failed, or one sent home before shipping.
- **Switching it off.** It stops new climbs. A climb already under way carries on to its pull request.

The card shows the climber at work: what they're doing, their pull request, and a button to their terminal. It also shows how the last climb ended (merged, closed, found nothing, or failed) and how many there have been.

## One engineer

Every climb is Lt. Rhee's: one crew member owns the hill, rather than a new hire each time (`climbingEngineer` in `shared.ts`). They keep one record (`CLIMBER_ID`), so their name, face and terminal carry on from climb to climb, but each climb is a fresh Claude Code session on a new branch, starting clean. The next climb waits while they're still busy with the last one (fixing QA's findings on a pull request you've just closed, say).

They're not the chief engineer, Lt. Brennan: Brennan's retros only read the code and draft issues, and the climber is who changes it, taking those issues as gaps.

## A climb

A climb is an agent's work like a developer's (`task: 'climb'`), with differences:

- **Branch and desk.** They work on a branch of their own (`focus/climb-…`) and don't take one of the room's desks: they're main engineering's.
- **The brief** (`climbBrief` in `climb.ts`):
  - **What they've climbed before.** Every climb so far, newest first (see [Memory](#memory)): merged ones aren't redone, and a gap you turned down isn't taken again unless their hypothesis says what's changed.
  - **Measure.** They run `pnpm run scorecard --no-save` before changing anything; those numbers are the Before. The brief gives the [noise floor](../scorecard/README.md#noise-floor), and a gain only counts past it. A time is measured interleaved (base and change taking turns, 5 of each, medians compared), since the machine's load swings it far more than any one change.
  - **Rank.** They put every gap on one scale: harm first, then distance from the standard, then size. The gaps include:
    - the scorecard's numbers;
    - the office's open frictions (3 or more sessions in 14 days, with no retro decision yet);
    - the retro's accepted issues that no merge has closed.
  - **Shortlist.** Before choosing, the 3 to 5 strongest gaps as a scored table: Harm (1 to 5) and Distance from the standard (1 to 5), Score = 2 × Harm + Distance, Size (S, M, L) breaking a tie. They take the top that fits one pull request; a gap you turned down, with nothing changed since, scores no harm. Writing the scores down makes the pick a rule the next climb can check, rather than one session's feel (three fresh sessions on one brief once picked three different gaps).
  - **Hypothesis.** Before changing anything: which gap, the number it will move and by how much, and what would show them wrong, ending in a `Target: <metric key> <before> → <after>` line. It's the pull request's first section, with whether it held.
  - **Sign-off.** Anything that needs your sign-off (a dependency version, how the office merges or deploys) is listed, not done.
  - **Fix.** A check first when the bad pattern can come back, then the smallest change. A planted bug proves each new test can fail.
  - **Prove.** The whole gate, then the scorecard again; those numbers are the After.
  - **Never:** `--no-verify`, loosening a rule or test, changing a dependency version, or two reasons in one pull request.
- **The pull request.** The office pushes their branch and opens it from their final message (`climbPullRequest`). Its first line (`# …`) is the title. The rest is the body:
  - **Shortlist**, **Hypothesis**, **Problem**, **Solution**, **Before** and **After**;
  - then anything that needs your sign-off.

  It closes no issue of its own; when the climber took a retro issue, they say `Closes #n` themselves.
- **QA and merging.** QA reviews it like any pull request the office opened, and a fail goes back to the climber. It **never merges by itself**, whatever auto-merge says: the plugin claims any `focus/climb-` branch for the captain, and the merge gate blocks it with "only the captain merges it" (`captainMerges` in `shared/mergeGate.ts`). The branch prefix keeps that true after the climber has gone home and after a restart. **Merge when QA passes** still works, since that's you saying so.

## Memory

Each climb starts a fresh session, so what Lt. Rhee knows of the climbs before comes from the brief (`Climbs.brief`, `climbLog` in `climb.ts`), built from the raw record each time rather than from a summary the office keeps:

- **GitHub**: every pull request on a `focus/climb-` branch, open, merged or closed (`pullRequestsFrom`), with its hypothesis (or, from before hypotheses, its Problem), its `Target:` line, and the gaps its shortlist passed over, with their scores (`shortlistOf`). A comment of yours on one goes in word for word: the office's own reports (QA's, the operations officer's), posted from the same account, are told apart by how they start, and bots are left out. To turn a climb down so the next one learns from it, close its pull request with a comment saying why.
- **The office**: the climbs that ended without a pull request, and why (`Climb.ends`, the last 20).
- **The scorecards**: for a merged climb with a target, whether main has held the gain, on the latest clean scorecard of main measured since it merged (`heldSince`). A gain that slipped back past its target is flagged as a gap worth taking.

GitHub failing costs the climb its log, not the climb: the terminal says so.

### Replay

`pnpm run climb:replay` tests the memory with an experiment rather than by reading the brief (`scripts/climbReplay.ts` here, rules in `scripts/climbReplayRules.ts`). Fresh read-only sessions do steps 0 to 2 of the brief from a measured scorecard (the latest saved, or `--card`), changing nothing, and answer with their scored shortlist and the one they'd take:

- the **control** gets the log as it is; its first session's pick becomes the rejected gap;
- the **treatment** gets the same log with that pick planted as a climb you closed, with a reason;
- a judge (`--judge`, Haiku by default) finds the rejected gap on each session's shortlist, if it's there.

It's **remembered** when the rejected gap is a real contender (the control's other sessions list it too) and no treatment session takes it; **repeated** when the treatment takes it at least as often as the control; otherwise **inconclusive** (try `--runs 5`). It also counts how many sessions took the top of their own shortlist by the scoring rule. Each run is saved in `~/.focus/climb-replays/` with every shortlist and judgement and what it cost. It runs real sessions, so it's by hand, not in the gate.

## Where it lives

The climber is a [plugin](../../docs/plugins.md): switch it on with `FOCUS_PLUGINS=climber`. Without it, there's no climber, no card and no climbing.

- **The plugin.** `server.ts` says what it adds to the office: its one brief (`climb`, worked away from the room's desks), the `POST /api/plugins/climber/keep-climbing {on}` switch, its hooks (board refreshes, a climb's pull request opening and closing) and `captainMerges` for `focus/climb-` branches.
- **Rules.** `climb.ts`, which is pure: the brief, the pull request from the write-up, what to do next (`climbStep`) and where the climbs are.
- **Running.** `climbs.ts` (`Climbs`) runs it, through what the office lends a plugin (`PluginHost`):
  - starting a climb, and holding on to its pull request from the moment the office opens it (so the climb outlives its climber going home);
  - starting the next when that merges or closes;
  - switching itself off.
- **When it looks.** It looks at the climb on every board refresh, and whenever you flip the switch.
- **Saved state.** The climb is kept in the plugin's slot in `state.json` (`plugins.climber`, a `Climb` from `shared.ts`). A `climb` saved before the climber was a plugin moves there by itself.
- **On the engineering panel.** `client.ts` draws the **Climber** card.
