# Goals: a lead per goal, four team stations per room

Today each room has one lead (`lead_<projectId>`) at one group desk, working one slice at a time in one long Claude Code session, next to six individual desks. This plan replaces that with **goals**:

- a room has **4 team stations** and **2 individual desks** (quick issue work);
- you start a goal by walking up to a free team station and telling it what you're after: that station gets **its own lead**, with its own Claude Code session, worktrees, slices and pull requests;
- goals run side by side, each in its own worktrees, and end when you close them (the lead can propose it);
- each goal keeps a small **goal note** (not a backlog), and its context is looked after on purpose rather than left to auto-compaction.

## What it's based on

From Anthropic's current guidance (Opus 5.5 / Sonnet 5.5 prompting guides, *Harness design for long-running application development*, compaction docs):

- A 1M window doesn't remove the need for context management. Long runs get summarised; keep the task checklist in a file, which survives the summary.
- Anthropic's own harness moved from context resets (with handoff files) to plain compaction once the models could hold a multi-hour build. What stayed useful from the old structure was a short "what done looks like" agreed per chunk, not up-front specs.
- Compaction works best when the harness chooses the moment and says what to keep.
- Keep the doer and the judge separate (we already do: QA).
- The "don't stop to report" prompt additions are for unattended agents; leave them out of human-in-the-loop work. The lead's "tell the captain and stop" stays.

And from the Agent SDK we're on (0.3.289): `getContextUsage()` on a running query, `compact_boundary` messages, a `PreCompact` hook, `forkSession`, and system-prompt **snapshotting**: on `resume`, a different `append` is ignored until the next compaction or a new session.

## Things in today's code this has to fix on the way

1. **The lead's system prompt goes stale.** `leadSystemAppend` includes the slice branch and the workspace list, but a resumed session keeps the system prompt it started with, so from slice 2 on it names slice 1's branch. Only `newSliceNote` in the message is correct. Fix: keep the system prompt stable (who you are, how to work) and put everything that changes (goal, branch, repos) in messages.
2. **Resumes skip the concurrency limit.** `message()` resumes a finished agent with `runSession` directly, past `schedule()` and `settings.maxConcurrent`. One lead made that harmless; four per room makes it matter.
3. **Nested worktrees are never reclaimed.** `claimBranch` (`worktrees.ts`) only works out the holder's agent id for top-level folders, so a lead's `lead_x/web` always counts as `held`. The lead's `alive` predicate in `checkOutSlice` never runs.
4. **Slice-1 branch names would collide.** `sliceBranch(..., id.slice(-4))` takes the suffix from the lead id, which would be the same for every goal in a room.

## Model

### A goal is a lead agent

Rather than a separate `Goal` entity, a goal *is* its lead: the `Agent` with `task: 'lead'`, which already owns the session, worktrees, slices and PRs. `LeadWork` grows:

```ts
interface LeadWork {
  station: number;            // 0..TEAM_STATIONS-1, the team station it sits at
  title: string;              // the goal in a few words: from your first message, then the lead's own wording
  note: GoalNote;             // see below
  closing?: { reason: string; at: number }; // the lead proposed wrapping up
  repos: …; slice: number; prs: LeadPr[];   // as today
}
```

- **Id:** `lead_<projectId>_<suffix>` (top-level folder under `data/workspaces/`, so the sweep keeps working; worktrees stay nested as `<id>/<repo>`). `leadId(projectId)` goes away. The client finds leads with `state.leadsIn(projectId)` and `leadAt(projectId, station)`.
- **Desk:** leads keep `desk: LEAD_DESK` and sit by `lead.station`. `desk` keeps meaning an individual desk.
- **Name:** `leadFor(projectId, suffix, taken)`, seeded per goal, avoiding the surnames of the room's other leads as well as the planner's and QA's.
- **Branch:** `focus/<goal-slug>-<slice>-<random>`, from the goal title. Unique per goal and per slice.
- **Shared constants:** `TEAM_STATIONS = 4`, `DESKS_PER_ROOM = 2` (renamed `SOLO_DESKS` if that reads better). `Project.maxAgents` now caps the individual desks, clamped to 1..2.

### Closed goals go in the room's log

Closing a goal dismisses its lead (freeing the station and removing the worktrees) but first files a `GoalRecord` on the project:

```ts
interface GoalRecord { id: string; title: string; note: GoalNote; slices: number; prs: LeadPr[]; sessionId?: string; leadName: string; openedAt: number; closedAt: number }
Project.goals?: GoalRecord[]   // persisted with the project, newest first, capped (say 30)
```

**Reopening is left out for now.** The log keeps the `sessionId` and note, so either way of reopening (fresh code, or restoring the last branch) can be added later without changing anything here. We decide once we've closed a few goals and know whether we miss them.

## Starting, switching and ending a goal

**Start:** walk up to a free team station → E → "Start a goal here" (text box, effort picker: see *Effort per goal*) → `POST /api/projects/:id/goals { text, station, effort? }` → `startGoal(projectId, station, text, effort)` seats a lead there. It's queued like any agent and checks out every repo of the project on its first branch.

**Talk:** E at an occupied station opens that lead's panel, and messages go to `POST /agents/:id/message` as they do today. **L** opens the nearest station's lead, or the goals list if you're not near one.

**Other ways in:** the planner card's and Number One's "hand to the lead" and the board's 🧭 button now ask *which goal*. The choices are an existing goal, or a new goal. All of that lives in one small picker.

**When every station is taken, new goals queue.** `Project.goalQueue?: { id, text, from, effort?, at }[]` is persisted with the project and shown in the Goals list, where you can reorder or drop entries. Queued goals never start on their own. When a goal closes, the freed station shows the first queued goal as "Next up", and a toast says the station is free. You start it from the station or the Goals list with one press, with its text and effort already filled in and editable. Until then nothing is seated and nothing runs. A pure `nextGoal(queue)` picks which goal is offered. Starting a goal from the Goals list while the room is full queues it the same way.

**Ending, both ways:**
- *The lead proposes.* A new office tool, `mcp__office__propose_close({ reason })`, is for when the goal's "done" is met, or when a slice lands and nothing worthwhile is left. It sets `lead.closing`, the station's sign shows "Ready to wrap up", a toast fires, and the lead stops. You confirm with **Close goal**, or carry on talking, which clears `closing`.
- *You close it,* any time, with **Close goal** in the lead's panel.

Closing checks first, through a pure `closeCheck(lead, dirtyFolders)` → `ok | { warn: … }`: uncommitted changes ("these are thrown away") or open PRs ("they stay open on GitHub, unowned"). The panel shows the warning and asks again. Then it files the `GoalRecord` and dismisses the lead.

**Several at once:** each goal has its own worktrees and branch, so they don't touch each other's checkouts. They can still conflict at merge, like any two PRs. Their reviews run side by side too: see *QA for goals* below. Leads count against the global `maxConcurrent` (fix 2 routes resumes through `schedule()`, so a lead past the limit shows "Waiting for a free slot"). They don't count against the room's individual desks.

## Effort per goal

A lead's work ranges from talking a goal through to a hard cross-repo slice, so effort is part of the goal, not a global setting. Today a lead never sets one and runs at the model's default (Opus 5.5: `medium`).

- **Picked when the goal starts:** the station's start box has the same effort picker as hiring an agent. It defaults to a new setting, `Settings.leadEffort`, set to `high`. Anthropic's guides suggest `medium` for well-specified agentic work and `high` for harder or longer work, and a lead's work is usually the latter. Queued goals keep the effort they were queued with.
- **Changeable at any time:** an effort chip on the lead's panel and the station's side panel. Between turns it just updates `agent.effort`, because every turn starts a new query with it. During a turn, `AgentSession.setEffort` calls the live query's `applyFlagSettings({ effortLevel })`, so it takes effect on the next request. The lead's log gets a line saying it changed.
- **What the picker says about each level**, from the Opus 5.5 and Sonnet 5.5 guides:
  - `low` and `medium` are quicker and cheaper, but more likely to stop and check in mid-slice.
  - `high` suits most slices.
  - `xhigh` and `max` are for slices where it's worth it. At those levels the model may start its own review rounds and reviewer subagents. That's kept on purpose: the lead's prompt does **not** get the guides' "don't start extra review rounds" line. The picker just says these levels take longer and cost more. Those subagents show up at the table as helpers like any other.
- **Cost of changing:** a change of effort invalidates the prompt cache for the next request, so the chip says that changes cost a little. It's not something to flip every turn.
- **Reviewers:** a goal's floating QA reviewer runs at a room-level QA effort (`Project.qaEffort`, default the model's), the same one the room's QA officer uses. Not per goal.
- **Pure piece:** `goalEffort(requested, settings)` with a test (falls back to `leadEffort`).

## QA for goals: floating reviewers

One QA officer per room would make four goals queue behind each other, so each goal gets its own **floating QA reviewer**, who comes to the lead's table to review that goal's pull requests.

- **Who reviews what:** a pure `reviewerFor(review, leads)` decides. A PR a lead owns (it's in `lead.prs`) goes to that goal's reviewer, `qa_<leadId>`. Anything else, meaning individual desks and PRs re-tested from the board, goes to the room's QA officer at the QA station, as today.
- **One record per goal,** reused from review to review, like `qa_<projectId>` today. Each review is still a fresh session, so the reviewer stays independent of the lead. A goal shipping PRs in two repos has them reviewed one after the other by its reviewer. Different goals review at the same time.
- **`nextReview` becomes per reviewer:** the reviewer takes the oldest queued review that `reviewerFor` gives them. Everything after that (`launchReview`, `finishReview`, the fix rounds, `leadHearsVerdict`, triage) is unchanged, because it's keyed by agent id and PR.
- **Limits:** reviewers are deskless and count against the global `maxConcurrent` only. `schedule()` already starts reviews first. A goal's reviewer is dismissed when the goal closes.
- **Where they sit:** the reviewer's own seat at each pod, opposite the lead. The reviewer beams in when a review starts and leaves when it ends. Their laptop shows the review, and E on them opens the QA panel for that PR, as at the QA station.
- **Names:** `qaFor(projectId, leadId, taken)`, seeded per goal, avoiding the room's other crew's surnames, as for leads.

## The goal note

A small structured note the lead keeps through an office tool, **not** a file in a repo (repos get fresh worktrees each slice). It's the part of the goal that survives compaction, resumes and reopening:

```ts
interface GoalNote {
  done: string;                              // what "done" looks like: a few lines, agreed at the start, changed only when you change it
  slice: { text: string; done: boolean }[];  // this slice's checklist; wiped when the slice lands
  learned: string[];                         // one or two lines per slice: what it taught us, what we decided and why
  next: string[];                            // at most 3 candidate next slices; rewritten, not appended to
}
```

- **Tool:** `mcp__office__note({ done?, slice?, learned?, next? })`. It replaces the fields it's given, except `learned`, which appends one line.
- **Limits enforced in code:** a pure `checkNote(note)` in `lead.ts` with tests. Roughly: `done` ≤ 400 chars, `slice` ≤ 7 items, `next` ≤ 3 items, `learned` ≤ 10 lines of ≤ 200 chars each. Over a limit, the tool returns an error asking the lead to trim or merge lines, so the note can't grow into a spec.
- **Nothing carries over:** at slice landing the office clears `slice`. Unfinished items go into the next slice's checklist or into a `learned` line saying they were dropped. The prompt says so.
- **Optional:** for a one-slice goal the lead can leave `slice` empty. The system prompt says to keep a checklist "when the slice has more than a couple of parts".
- **Visible:** the station's side panel shows the title, the `slice` checklist and the context meter. The lead's agent panel shows the whole note.
- **Used as the hand-off:** `noteForPrompt(note)` renders it for the new-slice message, the compaction instructions and a reopened goal.

## Looking after each goal's context

Each goal having its own session already does most of the work: a session only ever holds one goal. On top of that:

1. **A stable system prompt.** `leadSystemAppend(agent, projectName)` covers who you are, how to work, slices, shipping, the note tool and ending. No branch, no workspace list. The workspace list moves to the first message, and to `newSliceNote` at each new slice. Pass `systemPrompt.snapshot: true` explicitly so the intent is visible.
2. **Compact when a slice lands.** When `sliceLanded`, before `nextSlice` sets up the new worktrees, the office runs one turn: `/compact <compactInstructions(note)>`. The instructions say to keep the goal, its "done", decisions and lessons, the captain's preferences and anything they asked to remember, and to drop diffs, file contents and tool output. A pure `afterLanding(lead, dirty)` → `'compact-then-next' | 'held-back'` decides. Compacting also refreshes the snapshotted system prompt.
3. **A context meter.** After each result the runner calls `query.getContextUsage({ detail: 'summary' })` and reports `percentage` through a new `hooks.context(pct)` → `Agent.contextPct`. It shows on the lead's panel and the station's side panel, with a **Compact now** button that queues the same compaction turn.
4. **Subagents to protect the lead's context.** One line in the system prompt: send broad exploration and long checks to subagents and keep their conclusions.

**Check in stage 3 before building on it:** that a `/compact <instructions>` prompt works through the SDK's streaming input on a resumed session, and whether a `PreCompact` hook can supply instructions for *auto* compaction too. If `/compact` can't be driven, the fallback is a fresh session at slice landing, seeded with `noteForPrompt(note)` and the last summary. That fallback is the reason the note has to be good.

## The room

Inside the room footprint (local x −7 door wall … +7 Kanban wall, z −6 … +6), rough zones, not final coordinates:

```
            z = -6 ───────────────────────────────────────────── 
            │  solo 1        pod 1             pod 2      QA ▣  PR ◯ │
  door      │  ▭           ⬡ +3 seats       ⬡ +3 seats              │   Kanban
  x = -7  ══╡                    ── central aisle (z ≈ 0) ──        ╞══ board
            │  ▭           ⬡ +3 seats       ⬡ +3 seats     New issue │   x = +7
            │  solo 2        pod 3             pod 4         kiosk   │
            z = +6 ───────────────────────────────────────────── 
```

- **Team stations (pods):** a new `client/src/world/teamStation.ts`, generalising `groupDesk.ts`. It's a hexagonal table with one seat per side: the lead's, 4 helper seats (one more than today's group desk; `seatHelpers` as today, any more helpers wait) and the floating QA reviewer's seat opposite the lead. It's a little bigger than the group desk, so the pods' final positions get settled with screenshots. It also has and a display with two parts: the lead's terminal (`StationScreen`) and a narrow LCARS side panel (goal title, slice checklist, context %, "Ready to wrap up"). The sign reads "Team station 1–4", or the goal title when it's taken. Pods sit either side of the central aisle, roughly at x ∈ {−2.2, 1.6}, z ≈ ±3.3.
- **Individual desks:** the existing `workstation()` consoles, 2 near the door, either side of the aisle.
- **QA station, PR table, New issue kiosk and Kanban board** stay put. The current group desk at the door-left corner goes.
- **Client wiring:** `ProjectRoom` gets `stations: TeamStation[]` in place of `lead/leadDesk/helperSlots`. It gets a new `Interaction` `{ kind: 'station'; projectId; station }`: empty gives "Start a goal here", taken gives `{ kind: 'agent', id }`. It also gets per-station viewpoints and screen marking by agent id, and `leadPanel.ts` becomes `stationPanel.ts`.
- **Checks:** `npm run zfight` (pods need the same offsets `groupDesk.ts` uses: the stand starting inside the top, the accent bar offset), colliders for every table and seat, and Playwright screenshots of a demo room with 4 goals and 2 solo agents.

**Moving existing state over** (on load, in `store.ts`):
- The existing `lead_<projectId>` becomes the goal at station 0. Its id stays as is, its `title` is "<project>'s first goal" until the lead renames it, and its note is empty.
- `maxAgents` is clamped to 2.
- Individual agents at desks ≥ 2: finished ones whose PR is open are dismissed, the way `freeDesk` already does when it evicts. Anyone else (stopped or failed, possibly with unpushed work) keeps its record and worktree, goes to `queued`, and takes a desk when one frees up, rather than being thrown away.

## Stages

Each stage passes `typecheck`, `lint` and `test`, and gets a demo run before it's pushed.

1. ✅ **Goals on the server.** *(Done. Until the room is rebuilt in stage 5, the group desk seats the lead of the room's first goal and the others are reached from the goals list; a fifth goal is refused until the queue arrives in stage 2.)* Fixes 1–4. Several leads per room with station, id, name and branch. `startGoal` and `POST /projects/:id/goals`. Moving `lead_<pid>` over. The demo runner reads the repos from the prompt instead of `systemAppend`, and the demo seeds two goals. On the client: a 2D **Goals** list (board panel and **L**) to start, open and see goals, so it's usable before the 3D work. Effort picked at start (`leadEffort` setting, `goalEffort`). Tests: station picking, naming without clashes, branch names, the system prompt containing no branch, `goalEffort`.
2. ✅ **The goal note, ending and queueing.** *(Done. The demo writes notes and proposes closing; the queue is tried through the goals panel and the API rather than seeded.)* `note` and `propose_close` tools, `checkNote`, `noteForPrompt`, `closeCheck`, the slice checklist cleared at landing, the `GoalRecord` log, the close route, panel buttons (Close goal, the effort chip with `setEffort` mid-turn), the goal queue with "Next up" at a freed station (`nextGoal`) and the picker for planner / Number One hand-offs. Tests for every pure function, and demo scripts that write notes, propose closing and fill the queue.
2b. **What Claude's doing, on screens.** When an agent keeps its own task list with Claude Code's task tools (TodoWrite, or TaskCreate and TaskUpdate), the office follows it from the session's messages without changing how the agent works: a pure reducer turns each call into `Agent.tasks`, which the agent's panel shows. The LCARS screens get panes side by side (terminal, browser, Claude's tasks and, for a lead, the goal note's slice checklist), each of which a viewer can toggle on or off (a per-viewer preference, kept in the browser). The demo's agents keep task lists too.
3. **Floating QA.** `reviewerFor`, a per-goal reviewer `qa_<leadId>`, `nextReview` per reviewer, dismissal on close, and names. Tests for `reviewerFor` and for two goals' reviews running at once in the demo. (Their seats come with the room in stage 5; until then they show up in the QA panel and the agents list.)
4. **Context.** The `/compact` check, compaction at slice landing (`afterLanding`, `compactInstructions`), `getContextUsage` → `contextPct` and the meter, Compact now, and the subagent line in the prompt.
5. **The room.** `teamStation.ts`, the new layout, 2 individual desks plus the moving-over of their agents, station interactions and panel, reviewer seats, side-panel drawing, zfight and screenshots.
6. **Docs.** README (feature tour and architecture map), and CLAUDE.md's lead, QA and desk conventions (`LEAD_DESK`, `lead_<projectId>`, `qa_<projectId>`, the group desk).

## Decided

- **Effort:** chosen per goal at the start (default `high`), changeable at any time from the lead's panel.
- **No free station:** hand-offs and new goals queue, and a freed station offers the first one as "Next up".
- **QA:** each goal gets a floating reviewer at its table, so goals' reviews run side by side. The room's QA officer keeps individual desks' PRs.
- **Reopening:** not built yet. The log keeps what it would need.
- **Queued goals** wait for you to start them. They never start on their own.
- **Seats:** each pod seats the lead, 4 helpers and the goal's QA reviewer.
- **`xhigh`/`max`** keep their own review rounds and reviewer subagents. Nothing in the lead's prompt holds them back.
