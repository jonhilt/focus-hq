# The climber

Main engineering's climber takes the [scorecard](scorecard.md)'s worst gap in Focus's own repo and fixes it. Each fix is one pull request with the numbers measured before and after. You approve each one. It's a hill-climb, after [ratstack's hill-climb prompt](https://ratstack.sh/prompts/hill-climb):

1. measure;
2. take the top gap;
3. fix it;
4. prove the fix with the same numbers;
5. ship it;
6. go again.

## Keep climbing

The **Climber** card on the engineering panel (<kbd>E</kbd> at Lt. Brennan's station on deck 5) has the **Keep climbing** switch. It's off to begin with.

- **What it climbs.** It climbs the project that holds the office's own repo, which the office finds from its checkout's `origin` remote. The demo office has no repo of its own, so it climbs its first project's first repo. With no project holding the repo, the switch says to connect it first.
- **One climb at a time.** With the switch on and no climb open, a climb starts. The next starts only once you merge or close the last one's pull request.
- **When climbing switches itself off.** A climb that ends without a pull request switches climbing off and says why on the card. That's a climber who found nothing worth changing, one who failed, or one sent home before shipping.
- **Switching it off.** It stops new climbs. A climb already under way carries on to its pull request.

The card shows the climber at work: what they're doing, their pull request, and a button to their terminal. It also shows how the last climb ended (merged, closed, found nothing, or failed) and how many there have been.

## A climb

The climber is an agent like a developer (`task: 'climb'`), with differences:

- **Branch and desk.** They work on a branch of their own (`focus/climb-…`) and don't take one of the room's desks: they're main engineering's.
- **The brief** (`climbBrief` in `server/agents/climb.ts`):
  - **Measure.** They run `pnpm run scorecard --no-save` before changing anything; those numbers are the Before.
  - **Rank.** They put every gap on one scale: harm first, then distance from the standard, then size. The gaps include:
    - the scorecard's numbers;
    - the office's open frictions (3 or more sessions in 14 days, with no retro decision yet);
    - the retro's accepted issues that no merge has closed.
  - **Sign-off.** Anything that needs your sign-off (a dependency version, how the office merges or deploys) is listed, not done.
  - **Fix.** A check first when the bad pattern can come back, then the smallest change. A planted bug proves each new test can fail.
  - **Prove.** The whole gate, then the scorecard again; those numbers are the After.
  - **Never:** `--no-verify`, loosening a rule or test, changing a dependency version, or two reasons in one pull request.
- **The pull request.** The office pushes their branch and opens it from their final message (`climbPullRequest`). Its first line (`# …`) is the title. The rest is the body:
  - **Problem**, **Solution**, **Before** and **After**;
  - then anything that needs your sign-off.

  It closes no issue of its own; when the climber took a retro issue, they say `Closes #n` themselves.
- **QA and merging.** QA reviews it like any pull request the office opened, and a fail goes back to the climber. It **never merges by itself**, whatever auto-merge says: the merge gate blocks any `focus/climb-` branch with "the captain merges climbs" (`captainMerges` in `shared/mergeGate.ts`). The branch prefix keeps that true after the climber has gone home and after a restart. **Merge when QA passes** still works, since that's you saying so.

## Where it lives

- **Rules.** `server/agents/climb.ts`, which is pure: the brief, the pull request from the write-up, what to do next (`climbStep`) and where the climbs are.
- **Running.** `server/agents/manager/climbs.ts` (the `Climbs` part) runs it:
  - starting a climb, and noting its pull request;
  - starting the next when that merges or closes (from `Seating.prClosed`);
  - switching itself off.
- **When it looks.** It looks at the climb on every board refresh, and whenever you flip the switch.
- **Saved state.** The climb is kept in `state.json` (`Climb` in `shared/types/climb.ts`), and `POST /api/climb {on}` is the switch.
