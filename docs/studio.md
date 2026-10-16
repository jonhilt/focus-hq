# The TV studio

Episodes about Claude Code, filmed on the ship: the crew are the cast, demo mode acts out the story, and you narrate.
A scene script says what happens and where the camera looks; `pnpm run studio` films it, no AI calls involved, and
gives you a rough cut to record a voiceover against.

```sh
pnpm run studio scenes/subagents.yaml               # film: studio-out/subagents/rough-cut.mp4 and beats.md
pnpm run studio scenes/subagents.yaml --voice vo.m4a  # mix your voiceover in: studio-out/subagents/final.mp4
```

It needs ffmpeg on the PATH (`brew install ffmpeg`) and Playwright's Chromium. Filming takes as long as the episode,
plus a few seconds to cut.

## What it does

1. Starts a demo office with `--studio` on a free port: the usual fake GitHub and scripted agents, but one project and
   no goals, its dice (`Math.random`) and ids seeded from the scene's `seed`, so the same crew plays the same story each
   run, at the scene's `speed`.
2. Films the explainer insert, if there is one: the same page a lead's explain tool makes, played once from the top.
3. Opens the office at `?studio=1` at 1920 × 1080 and plays the beats in order, as the captain would: it starts the goal,
   answers the lead's question, and approves whatever the lead asks permission for. Each beat moves the camera, puts its
   caption up, waits for its cue, and holds.
4. Cuts the two videos into `rough-cut.mp4` (H.264, 30 fps), with the explainer let in where its beat is, and writes
   `beats.md`: each beat's time in the cut and its caption, to read your voiceover against. `beats.json` has the same.

The same scene gives the same beats, shots and captions each run, in the same order. Their lengths can drift by a second
or so, since the browser plays in real time: record the voiceover against the rough cut you'll mix it into.

## `?studio=1`

The director, `client/src/ui/studio.ts`, exists only with the flag, as `focusHQ.studio`. It hides the HUD, draws the
caption across the bottom and a tag over the head of everyone at the goal's team station (the lead, each helper's
subagent type, model and effort, and the QA reviewer). It holds the camera itself (WASD does nothing) and moves it by
shot name: `shot(name, glide?)` cuts through a blackout, or glides there over `glide` seconds. `cue(name)` says whether a
cue has come, and `say(title, caption)` puts a caption up.

## Scene scripts

A scene is a YAML file in `scenes/` (read by `readScene` in `shared/studio.ts`, which says what's wrong with one):

```yaml
title: How subagents work
speed: 0.5          # the demo's pacing: below 1 is slower than `pnpm run demo`
seed: 7             # the same seed casts the same crew and rolls the same waits
project: Sock Shop  # the demo project the goal goes to (it has two repos, so the lead starts two helpers)
goal: Shoppers can save items for later and find them again on any device
scenario: subagents # which parts of the demo lead's story it plays (below); without one, the whole story
beats:
  - title: Helpers sit down     # shown over the caption, and the beat's name in beats.md
    caption: The lead hands each repo to a helper…
    shot: helpers               # where the camera goes
    glide: 3                    # seconds to glide there; without it, a cut
    until: helpers-working      # what the beat waits for before it holds
    hold: 8                     # seconds it holds after that (default 4)
  - title: What's a subagent?
    insert: explainer           # the scene's explainer plays here, as a cut-away
    caption: …
explainer:                      # the same input as a lead's explain tool: title, beats, stage
  …
```

- **shot**: `bridge` (where you come aboard), `holodeck` (the project's training hall), `station` (the captain's view
  of the goal's screen), `lead` (the lead, three-quarters on), `helpers` (the helpers at their consoles), `crew`
  (the whole briefing room from a corner by the screen), `transporter` (the transporter room the lead's longest-running
  workflow beamed into, from its feed's camera: it waits for a workflow to start).
- **do**: `start-goal` (the scene's goal, at the first free team station), `answer` (picks the first option of the
  lead's open question), `reply` (sends `say:` to the lead). The goal starts before anything else acts on its lead.
- **until**: `lead-working`, `lead-idle` (its turn has ended), `helpers-working`, `helpers-done`, `workflows-running`,
  `workflows-done` (every workflow it has finished, caught while they linger), `shipped` (its slice has a pull request). A cue that hasn't come in three minutes stops the filming and says which.

## Scenarios

A demo goal's lead plays one story: it looks round, asks which layout to start with, then builds a slice across every
repo and ships it. A scene's `scenario` keeps that story to what the episode is about (`shared/scenarios.ts`), so a
shot of the station isn't busy with things the narration never mentions:

- **`full`** (the default, and what `pnpm run demo` plays): all of it, including the explainer on the station's screen,
  a helper per repo, a probe script with the dev server and a monitor in the background, and the workflows that map the
  repos and review the slice in the transporter rooms.
- **`subagents`**: the helpers (an Explore subagent per repo, side by side), and none of the rest.
- **`workflow`**: the workflows, and none of the rest.

Each has a scene of its own in `scenes/` (`subagents.yaml`, `workflow.yaml`, `full.yaml`), which the recorder films and
the training console plays live; a test checks every scenario has one and every scene reads.

Looking round, asking, building, shipping, hearing back from QA and the slice landing play in every scenario. The
recorder hands the scene's scenario to its office as `FOCUS_DEMO_SCENARIO`; a goal keeps the scenario it started with.
As with real Claude Code, whose Workflow tool waits until you ask for one in your own words, telling a demo lead to
"run a workflow" (or "use a workflow", or ultracode) brings the workflows into that turn, whatever the scenario
(`asksForWorkflow`).

## The training console

To play a scenario live rather than film it, the demo ship has a training console on the bridge: a gold workstation
on the starboard side aft of the rail, on your right as you come aboard (`world/trainingConsole.ts`, only in a demo
office). **E** on it lists the scenarios (`ui/trainingPanel.ts`); picking one resets the ship to the quiet start the
studio films from (`server/training.ts`, `POST /api/demo/training`):

1. everyone goes home, then goals, the line of goals waiting for a team station, QA reviews and the ledger are cleared;
2. the demo GitHub goes back to its seed repos and pull requests (`demoReset`), and the dice roll from the top
   (`TRAINING_SEED`), so the same crew plays the same waits each run;
3. the demo runner takes the scenario for the next goal, whose goal (`TRAINING` in `shared/scenarios.ts`) waits in line
   at Sock Shop's team stations, and every browser starts over from a fresh snapshot.

When a scene in `scenes/` plays the scenario (its `scenario:`, or none for `full`; the first by file name), its goal,
project, seed and steps stand in for the console's own (`sceneFor` in `server/training.ts`).

Then you're beamed to Sock Shop's team station 1, where the goal waits, and you play it, walking wherever you like. A
pill over the bottom of the screen says which of your moves comes next, from the scene's `steps:`
(`shared/trainingSteps.ts`, `ui/trainingSteps.ts`):

```yaml
steps:
  - start-goal            # starts the waiting goal at team station 1
  - answer                # takes the first option of the lead's question
  - approve               # grants what the lead asks permission for (to ship, say)
  - merge                 # merges the slice's pull requests
  - reply: Go ahead with the next slice, and run a workflow to review it before you ship
```

- **]** makes the next move for you, as you would through its screen. A reply is typed out in the pill first, so it
  reads as typed on a recording. An answer or reply waits for the lead to finish its turn, as you would.
- **[** steps back one, so **]** can make that move again: nothing's undone.
- **-** and **=** slow the demo's agents down and speed them up (0.1× to 3×, `SPEEDS` in `shared/scenarios.ts`), from
  their next wait on, so a workflow's away team beams in slowly enough to narrate over. A reset starts at the scene's
  `speed` (0.5×, half `pnpm run demo`'s; `POST /api/demo/speed`), and the pill shows where it is.
- A move you make by hand through a screen moves the pill on too (a reply leaves nothing to tell it by, so only **]**
  moves past one).

A scene without `steps:` gets start the goal, answer, approve, merge. The steps live in the page: reloading it, or
picking another scenario, starts over.

## The holodeck stage

`pnpm run studio --stage delegation` films a **shot plan** on an empty holodeck instead of the busy ship: only what the
plan casts beams in, on the yellow grid, so it's the same every run and follows the narration's timing. A plan is
`scenes/<name>.plan.yaml`, in the format the director writes (`studio/director.md`, "The shot plan"):

- **`beats`**: the narration, a sentence each, with the start of each stressed word as a mark. Every time in the plan is
  an anchor on them (`r2`, `r2.fresh`, `r2.fresh-0.2`, `r1+2.8`, `r2.end`), so re-timing the beats from a real take moves
  every shot with it. `preview: { captions: true }` shows the beats' words as subtitles while there's no voice yet.
- **`cast`**: `crew` (in a bridge seat with a PADD, facing `left` or `right` on screen and `turn`ed towards the audience,
  with `gauge: true` for a context column beside them), `gauge` (a big in-world context column, `of` a crew member),
  `list` (a task queue), `slate` (the workflow's script), `label`, `pad` (a grid of transporter pads), `lane` (a
  `/batch` lane: a crew member in a worktree, its marker, and its pull request card) and `card` (the closing ladder).
- **`shots`**, back to back: a `span`, a `camera` and what happens (`do`). The camera is **framed**, not placed: a shot
  size, where each subject sits on screen (`on`), the `angle` and `fov`, and the stage solves where the camera goes
  (`shared/framing.ts`), with an optional move (`push-in`, `pull-out`, `truck`, `crane`, `orbit`, `zoom`) or a list of
  `keys`. Each shot hands over by `cut`, `move` (the camera carries on into the next shot), `dissolve` (a dip through
  dark) or `grid-wipe` (a band of holodeck grid with a chapter card, which `resets` props behind it).
- **Acts**: `beam-in`/`beam-out`, `say`, `status`, `fill` (a gauge), `show`/`hide` (including a gauge's `ghost`, an
  earlier level marked), `send` (jobs fly low, answers high), `tick` (a queue), `label`/`count`, `glow`, `cycle` (pads
  run waves until a total), `progress` (lanes) and `title` (a chapter card). Lists of targets spread by `gap`.

`shared/stagePlan.ts` reads a plan and compiles it into a timeline (with tests); the browser's player is
`client/src/ui/stage/`. A `--studio` office serves the plans at `/studio/plans/<name>`, and `?studio=1&stage=<name>`
plays one: come aboard and call `focusHQ.studio.playStage()` (or `playStage(52)` to start 52 s in, though what should
have come and gone by then can linger). Filming prints anything the plan asked for that the stage can't do yet.
Episode 1 is `scenes/delegation.plan.yaml`, the director's plan with placeholder narration; the clip lands in
`studio-out/stage-delegation/clip.mp4`.

## Narration

The narration is recorded first, to camera, and the shot plan is timed to it. `scenes/<name>.narration.yaml` names the
takes (video files) and the spans of each to keep, in order:

```yaml
takes:
  t1: ~/Movies/2026-10-12 13-36-19.mp4
  t2: ~/Movies/2026-10-12 14-07-53.mp4
keep:
  - { take: t1, from: 0, to: 186.7 }
  - { take: t2, from: 0, to: 133.95 }
  - { take: t2, from: 140.2, to: 204.6 }   # skips a repeated line
maxPause: 0.6
```

`pnpm run studio --narrate <name>` transcribes each take with whisper.cpp on this machine (the same `whisper-cli` and
model as voice input, `docs/voice-input.md`; cached per take), keeps the spans without fillers (um, uh) and with pauses
longer than `maxPause` shortened, and writes `studio-out/narration-<name>/`: `narration.mp4` (the presenter's picture and
voice), `words.json` (every word's time in it) and `beats.json` (the words grouped into beats, for the director to plan
against). `shared/narration.ts` does the cutting decisions, with tests. When a stage's narration exists, filming it also
writes `episode.mp4`: the holodeck with the presenter picture-in-picture in the bottom-right corner and their voice under
it.

## The studio holodeck

Walk into the studio, say what you want to see, and the holodeck builds it in front of you as a moving 3D scene you can
walk round. It's an empty holodeck with a computer of its own: a Claude session that belongs to the studio, not to a goal
or a project. The first vacant holodeck is the studio (the sign on its door says so); walk in, press **Enter** (or **E** on
the far wall's hologram), and describe something: a mechanism, a process, a system, a metaphor for one. The studio is
bigger on the inside than a training hall: it keeps the hall's doorway but sets the rest of its shell aside for a grid of
its own, its round wall 17 m from the middle (a training hall's is 11 m) and its ceiling 8 m up, with nothing on the
floor to walk into but its walls (`STUDIO_HALL` and `studioWalls` in `client/src/world/studio.ts`,
`VacantHall.enlarge` in `room.ts`). The chat docks down the right, so the room stays in view while the computer builds.

- **Saying it**: hold **V** anywhere in the studio, say what you want to see, and let go. The recording is transcribed
  on this machine, as [voice input](voice-input.md) is, and sent straight to the computer, as if typed in its chat; a
  pill over the bottom of the screen says it's listening, transcribing, and what it sent
  (`client/src/ui/studioVoice.ts`). While the computer works, the far wall's hologram says what it's doing at its top
  right ("COMPUTER · BUILDING THE SCENE…", `signStatus` in `client/src/world/studio.ts`), so you can follow along with
  the chat shut. V does nothing while the computer is still on the last thing you said. It needs voice input set up
  (whisper.cpp and its model); in the demo every recording is the demo sentence, which builds fan-out.
- **Models** (its `model` tool): for how real code works (a feature, a data flow, an architecture), the computer
  doesn't draw freehand. It recovers a **system model** from the code itself (routes, handlers, components, types,
  calls, schema), not from docs: the parts (each a kind: ui, route, handler, service, store, queue, external, job or
  type, and a layer), the connections between them (calls, reads, writes, emits or renders), and one concrete
  scenario as ordered steps along the connections, each with the payload that moves. Every part cites the file and
  line where it's defined, and every connection the line where one part reaches the other. The office **checks each
  cite against the code** (`checkModel` in `shared/systemModel.ts`, reading only the projects' checkouts, the agents'
  worktrees and the office's own code: `server/agents/studioSource.ts`; the computer can read the office's own code
  without opening it as a project): a part is found when its file has the line
  and its symbol is within two lines of it, a connection is backed when its cited line (or one within two of it)
  mentions the part it reaches (an import line doesn't count as where a part is defined, except for something outside
  the code). It also tells the computer where the scenario jumps (a step that starts neither where the last ended nor
  where it started) and when a model has more than 16 parts. What didn't check out is drawn in red and told to the computer, which fixes it and
  sends the model again before saying it's ready. The holodeck draws every model the one fixed way, flat, on three solid hologram boards standing in an
  arc round the middle of the hall like a war room (`client/src/world/modelScene.ts`), each a view of the same model
  (`shared/modelDrawing.ts`, a list of shapes drawn to a canvas for the boards and to SVG up close, so both match):
  **structure** in the middle (each part a shape for its kind (window, hexagon, square, rounded box, cylinder, pill,
  ellipse, triangle or diamond) outlined in its layer's colour with its name and file:line, laid out by the office as a layered
  diagram (`layoutLayers`: loops back are broken first, each part's column is the longest run of connections into
  it, each column ordered by its neighbours to cut crossings, one part to a place; a bigger model grows the drawing
  rather than squeezing it, and up close each view keeps a readable scale and scrolls sideways), each connection an arrow coloured by its kind, a key along the foot),
  the scenario as a **sequence** diagram on the right (a lifeline for each part it passes through, an arrow for each
  step with its payload over it), and **what moves at each step** on the left (with what was simplified and two or
  three questions to check yourself with). The step under way is gold on all three at once, in time with the scene's
  clock, so a model plays, pauses, scrubs, retimes and goes on the shelf like any scene (its steps are its phases, s1,
  s2…). What the code check couldn't confirm is red and dashed. **E** on a board opens the model up close
  (`client/src/ui/modelPanel.ts`): the three views live and crisp, ◀ ▶ (or ← →) to step through the scenario, and a
  click on a part in any view picks it in all of them and shows the lines of code it cites (`GET /api/studio/source`,
  through the same reader as the check), with its connections and their cites.
- **Scenes** (its `scene` tool, `server/agents/studio.ts`): for metaphors, ideas and things that might be built, which
  it says are illustrative. The computer builds straight away from what you said, rather than pitching or asking first, and the scene stands on a round stage 6 m across the middle of the hall
  (`SCENE_STAGE`), up to the ceiling, its front to the doorway. Motion is the point: it decides first what moves and
  what that movement means, in one sentence (the scene's metaphor), then writes a script against the studio's kit
  (`client/src/world/takeKit.ts`: crew standing or at consoles, boxes, balls, transporter pads, glowing lines, floating
  labels and a beam-in effect) and three.js itself (instancing for dozens of things, tracks, swarms, see-through
  containers, text on surfaces). It's asked to build in the round, since you'll see it from every side. The code still
  calls a scene a take (`StudioTake`, `takes.ts`).
- **Playing it**: the scene runs on a clock of its own (`ScenePlayback` in `client/src/world/studio.ts`), so it's yours
  to play while you stand in the studio, with the chat open or not (but not while typing in it): hold **Q** or **R** to
  spin it, **P** pauses it, **[** and **]** scrub half a second back or on (pausing it), and **-** and **=** step its
  speed from a quarter to double. A light runs round the stage's edge once a run through, and the far wall's hologram
  says what the scene is, its metaphor, whether it's playing or paused and at what speed, and the keys. It loops,
  holding its last frame a moment first.
- **Changing it**: say what to change and the computer stages it again under the same id, which swaps it in place.
  Its timing lives in named **phases** (`{"fan": [1, 3], "fold": [6, 8]}`) that its script reads with `phase(t, name)`,
  so "slower" is the `retime_scene` tool (a speed, or new seconds and phases) rather than a rewrite. Scripts get helpers
  that, like `render(t)`, depend only on the time (`shared/takeScript.ts`): `p` eases between two times, `settle` glides
  in without overshooting, `burst` flashes and dies away, `stagger` starts many parts one after another. These ideas
  come from [anatomy](https://github.com/wheresryan22/anatomy)'s explainers. A new id makes a new scene; the last 12 are
  kept, and the one staged or retimed last is the one in the hall (`currentTake`), so retiming an earlier one brings it
  back. One whose script throws turns the hologram red and says why, and the computer hears it too
  (`POST /api/studio/takes/:id/report`), so it can fix it.
- **The shelf**: **Tab** hangs every scene kept as a hologram card in an arc at eye height round where you stand, each
  with a picture of it (drawn once a version in the browser, three quarters of the way through it: `sceneThumbnail` in
  `client/src/world/contactSheet.ts`), the one in the hall picked and marked. The arrow keys or the mouse wheel swipe
  another card in front; **E** or **Enter** calls that scene back to the middle of the hall (`POST
  /api/studio/takes/:id/recall`, from its start), and **Tab** or **Esc** puts the shelf away. Calling one back adds a
  line to the chat, so the computer hears which scene is in the hall with whatever you say next
  (`client/src/world/sceneShelf.ts`, its arc in `shelfSpots`).
- **Looking before you do**: when the room runs a scene just staged, it renders a **contact sheet** (six moments
  through it, each phase under way and as it lands, and its last, each from a little further round it, as you'd see it
  walking round, in a scene and on a WebGL renderer of its own: `client/src/world/contactSheet.ts`) and sends it with
  its report, and the scene tool hands the picture to the computer, which looks for anything thin, cluttered, hidden or
  still and stages it again before telling you it's ready. No browser open, no sheet: the scene waits for you.
- **Real sessions** (its `sessions` and `session_timeline` tools): for something that really happened in Claude Code,
  the computer reads the session itself. It can read Claude Code's own session transcripts on this Mac
  (`~/.claude/projects`, or `CLAUDE_CONFIG_DIR`'s) and nothing else (`server/agents/studioSessions.ts`: `sessionRef`
  reads what it asked for as a session id or a transcript's path, and `readableTranscript` only lets through a `.jsonl`
  that, links followed, is inside that folder; both tested in `sessionTimeline.test.ts`, and `loadSession` against a folder on disk, a link out of it among them, in `studioSessions.test.ts`): it finds one
  by what it was about (Claude Code's title for it, what was first asked, its folder), then reads it as a timeline
  (`server/agents/sessionTimeline.ts`), told from code alone: what was asked, what Claude said and ran, and each
  subagent and workflow it started, stitched in from their own transcripts (`subagents/`, and a workflow run's
  `subagents/workflows/<run>/` with its journal): a fan-out as one moment, each agent with its brief, when it ran and
  what it handed back (or that it stopped), a workflow's phases with their agents, models and how many ran at once.
  The whole session fits about 8k tokens (tool runs, then Claude's words, go first when it's long); a time window
  zooms in on a stretch, with every call. It shares its reading of transcripts with the ledger's session digests
  (`server/agents/transcript.ts`, [the ledger](ledger.md)), but the digests count (for the report card, and the retro's friction reading), where a timeline
  tells the story in order, and reads any session, not only the crew's.

- **The ship and its projects** (its `ship_status` and `open_project` tools, the same as [Number One](../plugins/number-one/README.md)'s,
  `shipTools` in `server/agents/claudeCrew.ts`): for something aboard, like how proposals move through one of your
  projects or how the office runs a workflow, the computer reads the real thing before it builds. `ship_status` is the
  ship right now (each project's agents, goals and pull requests); `open_project` checks a project's repos out at their
  default branch, into the same `data/planning/<project>/` folders Number One reads, and the computer reads them with
  Read, Glob and Grep. Hidden projects are left out. Its instructions list the projects aboard and where each one's code
  goes once opened.

It's one Claude Code session for the whole conversation: each thing you say resumes it, so it remembers what it built
(and, should the session be lost, the next turn starts a new one with a recap of the conversation and the scenes it
kept). The chat's head says which model it's on and how hard it thinks, both yours to change from its next turn (kept
when you start over, `POST /api/studio/tune`; the ship's `model` setting and the model's default effort unless you
pick), what its last turn ran on, and what it's spent.

One conversation at a time, kept across restarts (`studio` in `data/state.json`); **Start over** clears the studio.
The computer reads the web, Claude Code sessions, the ship's state and its projects' checked-out code, and changes
nothing (`ClaudeStudio` in `server/agents/claudeCrew.ts`, working in `data/studio`), and its scene scripts run in your browser as the leads' explainers do. In `pnpm run demo` its
turns are scripted (`DemoStudio`): ask how something works (or how a lead ships) and it stages **ship-flow**, a model of how a lead's ship becomes a
pull request QA reviews, recovered from the office's own code with every cite found at runtime (a test checks they all
hold); describe anything else and it builds **fan-out**, a gold core beaming eight agents in on
pads round it and folding their answers back; ask for more and it runs sixteen; ask for it slower and it retimes it to
half speed; mention a pipeline, track or gates and it builds **pipeline**, work riding a track through three gates.
`FOCUS_STUDIO=live` puts the real computer in the demo office instead, to try the studio with a model without GitHub.

## Not yet

Packaging (captions, chapters, title, description, a thumbnail) and publishing come in later slices. Lengths aren't
exact to the frame; that would mean taking over the page's clock and capturing frame by frame.
