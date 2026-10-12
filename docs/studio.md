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
  (the whole briefing room from a corner by the screen).
- **do**: `start-goal` (the scene's goal, at the first free team station), `answer` (picks the first option of the
  lead's open question), `reply` (sends `say:` to the lead). The goal starts before anything else acts on its lead.
- **until**: `lead-working`, `lead-idle` (its turn has ended), `helpers-working`, `helpers-done`, `shipped` (its slice
  has a pull request). A cue that hasn't come in three minutes stops the filming and says which.

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

## Not yet

Packaging (captions, chapters, title, description, a thumbnail) and publishing come in later slices. Lengths aren't
exact to the frame; that would mean taking over the page's clock and capturing frame by frame.
