# The studio holodeck

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
