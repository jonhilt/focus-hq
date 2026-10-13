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

Then you play it: walk to a free team station in Sock Shop's holodeck, **E**, **Start it**, and answer the lead.

When a scene in `scenes/` plays the scenario (its `scenario:`, or none for `full`; the first by file name), its goal,
project and seed stand in for the console's own (`sceneFor` in `server/training.ts`), and the director takes you
through its beats over live play (`client/src/ui/liveDirector.ts`, its decisions in `shared/liveDirector.ts`):

- Each beat's caption goes up as the recorder would film it, with where you are in the scene top right.
- Its shot takes the camera (a cut through a blackout, or a glide) and holds it there until you walk; the mouse still
  looks round. A station's shots wait for its lead to sit down. The frames are the recorder's (`ui/shots.ts`).
- A beat the recorder would act out says what you do instead: start the goal, answer the lead, or what to tell it.
  While the lead waits on your permission (to ship, say), which the recorder grants as it's asked, it says to approve
  it. An explainer insert says it's a cut-away in the film.
- A beat with a cue (`until`) moves on by itself once the cue has come and its hold is up; one without waits for you.
  **]** moves on and **[** goes back any time; **O** hides the captions and stops the camera moves, while the beats
  keep counting by their cues.

The director lives in the page: reloading it, or picking another scenario, starts over.

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

Before a video is filmed it's thought through, and that happens standing in an empty holodeck with its own computer:
a Claude session that belongs to the studio, not to a goal or a project. The first vacant holodeck is the studio (the
sign on its door says so); walk in, press **Enter** (or **E** on the far wall's hologram), and say what the video's
about. The studio is bigger on the inside than a training hall: it keeps the hall's doorway but sets the rest of its
shell aside for a grid of its own, its round wall 17 m from the middle (a training hall's is 11 m) and its ceiling 8 m
up, with nothing on the floor to walk into but its walls (`STUDIO_HALL` and `studioWalls` in
`client/src/world/studio.ts`, `VacantHall.enlarge` in `room.ts`). The chat docks down the right, so the room stays in
view while the computer builds:

- **The video** (its `video` tool, `server/agents/studio.ts`): the premise on the far wall in a gold-edged hologram,
  with what the viewer should come away with; the narrative beats in numbered cards round under it, each with the lines
  said over it as the script builds up (**E** on a card, from anywhere on the floor, opens the chat's **Script** tab at that beat, with the whole
  video written out to read and narrate from); and each loose thread (something neither of you is sure how it works, a
  fact to check) hanging as a warm light in a row across the hall, just over your head between the doorway and the
  takes, its question on a tag you can read from where you come in. The computer
  reads the web to answer them: an answered thread turns green and rises away, a dropped one dims and sinks.
- **Real sessions** (its `sessions` and `session_timeline` tools): for a video about something that really happened in
  Claude Code, the computer reads the session itself. It can read Claude Code's own session transcripts on this Mac
  (`~/.claude/projects`, or `CLAUDE_CONFIG_DIR`'s) and nothing else (`server/agents/studioSessions.ts`): it finds one
  by what it was about (Claude Code's title for it, what was first asked, its folder), then reads it as a timeline
  (`server/agents/sessionTimeline.ts`), told from code alone: what was asked, what Claude said and ran, and each
  subagent and workflow it started, stitched in from their own transcripts (`subagents/`, and a workflow run's
  `subagents/workflows/<run>/` with its journal): a fan-out as one moment, each agent with its brief, when it ran and
  what it handed back (or that it stopped), a workflow's phases with their agents, models and how many ran at once.
  The whole session fits about 8k tokens (tool runs, then Claude's words, go first when it's long); a time window
  zooms in on a stretch, with every call. Then it pitches and builds from what really happened. It shares its reading
  of transcripts with the ledger's session digests (`server/agents/transcript.ts`, [the ledger](ledger.md)), but the
  digests count, for the retro, where a timeline tells the story in order, and reads any session, not only the crew's.
- **Pitches** (its `pitch` tool): before it builds anything for a beat, the computer pitches 3 to 5 ways to show it,
  each a one-sentence metaphor, how big it is and where it stands (a tabletop model, the room round you, something
  hall-sized overhead…), and how it holds up against the real numbers and limits. They're meant to differ in kind and
  scale (a physical analogy, something from the Star Trek universe), not be one scene rearranged. They show in the
  chat, numbered, each with a **Build this** button; to mix them or push back, say so. A beat's pitches stay in the
  chat until a take is staged for it, and stay listed under the beat in the Script tab (`openPitches` in
  `client/src/world/studio.ts`). The transporter room was found this way: several metaphors at different scales,
  checked against how workflows really run, then picked and stretched by the captain.
- **Takes** (its `take` tool): 3D visualisations of the beats, one or more for each, each a script the computer
  writes against the studio's kit (`client/src/world/takeKit.ts`: crew standing or at consoles, boxes, balls,
  transporter pads, glowing lines, floating labels and a beam-in effect) and three.js itself (instancing for dozens of
  things, tracks, swarms, see-through containers, text on surfaces), looping on an 8 × 6 m floor of its own. It's
  asked for a bold image that reads from across the room, not a thin sketch.

  The computer looks before you do: when the room runs a take just staged, it renders a **contact sheet** (the take
  from where you'd stand to watch it, at six moments (each phase under way and as it lands, and its last), in a
  scene and on a WebGL renderer of its own: `client/src/world/contactSheet.ts`) and sends it with its report, and the
  take tool hands the picture to the computer, which looks for anything thin, cluttered, hidden or still and stages it
  again before telling you it's ready. No browser open, no sheet: the take waits for you as before.
  Every take stays on the floor (up to 12), in a horseshoe round the room in beat order, from the left of the doorway
  round to its right, each facing the middle: stand there and turn, and you see the whole video. Up to six stand full
  size; more and they all shrink together to fit (`takeSpots` in `client/src/world/studio.ts`). The beat cards hang
  under the premise, above the takes' heads.

  Each take starts from a **metaphor**, decided before any geometry: one sentence on what the concept is shown as, what
  moves and what that movement means ("a gold core throws out fresh contexts and pulls back only their answers"). Its
  plaque shows its beat, label and metaphor (**E** on it opens the Script tab at its beat too); the Script tab lists each beat's takes with theirs. Its timing lives in
  named **phases** (`{"fan": [1, 3], "fold": [6, 8]}`) that its script reads with `phase(t, name)`, so "make c slower"
  is the `retime_take` tool (a speed, or new seconds and phases) rather than a rewrite: the script stays, and the take
  plays afresh a version on. Scripts get helpers that, like `render(t)`, depend only on the time (`shared/takeScript.ts`):
  `p` eases between two times, `settle` glides in without overshooting, `burst` flashes and dies away, `stagger` starts
  many parts one after another. These ideas come from [anatomy](https://github.com/wheresryan22/anatomy)'s explainers.

  Say what else to change and it stages the take again under the same id: it swaps in place. One whose script throws
  turns its plaque red and says why, and the computer hears it too (`POST /api/studio/takes/:id/report`), so it can fix it.

It's one Claude Code session for the whole video: each thing you say resumes it, so it remembers the conversation (and,
should the session be lost, the next turn starts a new one with a recap of the conversation and the video). The chat's
head says which model it's on and how hard it thinks, both yours to change from its next turn (kept across videos,
`POST /api/studio/tune`; the ship's `model` setting and the model's default effort unless you pick), what its last turn
ran on, and what it's spent.

One conversation at a time, kept across restarts (`studio` in `data/state.json`); **New video** clears the studio.
The computer reads the web but nothing of the ship's code (`ClaudeStudio` in `server/agents/claudeCrew.ts`, working
in `data/studio`), and its take scripts run in your browser as the leads' explainers do. In `pnpm run demo` its
turns are scripted (`DemoStudio`): describe a video and it puts up a premise, four beats, two threads and a take for
every beat (two for the second); ask for one at a time and it revises take b; ask for it slower and it retimes take c
to half speed; ask it to look a thread up and it answers t1. It also pitches four ways to show the second beat, and
**Build this** on one stages take g from it (a track through gates, built with three.js itself) and says it looked at
its contact sheet. `FOCUS_STUDIO=live` puts the real computer in the demo office instead, to try the studio with a
model without GitHub.

## Not yet

Packaging (captions, chapters, title, description, a thumbnail) and publishing come in later slices. Lengths aren't
exact to the frame; that would mean taking over the page's clock and capturing frame by frame.
