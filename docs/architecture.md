# Architecture

```
shared/types/             types shared by server and client, a file per feature (agents, goals, projects, github, qa, previews, events…) behind index.ts
shared/crew.ts            how the crew look (uniforms, species), and the permanent crew per room (the ops officer, the QA officer), derived from the project id
shared/qa.ts              QA decisions shared by server and board (badges, stale verdicts)
shared/systemModel.ts     the studio's system models: whether one holds together, checking its cites against the code, its timing, and its layered layout
shared/modelDrawing.ts    a system model's three flat views (structure, sequence, data) as shapes, and as SVG
shared/flows.ts           a recorded run's flows between the browser and the office (`pnpm run record-flows`): stack frames to repo files, counting, for net/api.ts and server/flows.ts
shared/board.ts           a project's Kanban columns (to do, in progress, PRs), for the 3D board, its panel and the Tricorder
shared/agentStatus.ts     how an agent's status reads (icon, one-line status)
shared/tricorder.ts       what needs you (the Tricorder and Comms), which agents are in flight
shared/ledger.ts          the ledger of how work went (QA verdicts, merges, conflicts, triage, goals, session digests): its line format, the check on load, and the report card
shared/usage.ts           how main engineering reads out your plan's usage (rows, tones, sign-in), for the panel and the MSD
shared/ledgerReview.ts    reviewing the ledger: each event as a line of the log, the window, and the trace of a pull request or a goal with its totals
server/
  supervise.ts            runs index.ts and restarts it after an auto update
  updater.ts              auto update: fetch, fast-forward, install/build, restart
  index.ts                express + WebSocket (/ws) + Vite middleware (dev) or dist/ (prod)
  office.ts               projects/rooms, Kanban boards (polling GitHub), auto-assign, settings
  store.ts                ~/.focus/state.json + per-agent terminal logs (jsonl) + the ledger (ledger.jsonl)
  ledgerLog.ts            the ledger's one writer: numbered lines flushed to disk, the lock file, repairs and damage on load
  usage.ts                main engineering's plan usage: read from Claude Code's structured /usage every few minutes, with how the office signs in
  routes.ts               REST API used by the panels
  frameStats.ts           the frame-stats log: what a browser opened with ?stats=1 sends of how its 3D view ran, a file per page load in ~/.focus/frame-stats/
  hostGuard.ts            who the office answers: known Host and Origin only (DNS rebinding, other sites' pages), for /api, pages and /ws
  hub.ts                  broadcasts ServerEvents to every browser tab
  flows.ts                with FOCUS_FLOWS set, counts each event the hub sends and each /api request against the files that sent them, handed over at GET /api/flows
  previews.ts             Preview: check a PR out, run the project's preview commands, find its links, tear it down (Effect: one Scope per preview)
  previewMachine.ts       what a preview does to this machine (shell commands in their own process group, signals, probes) as an Effect service
  plugins/                what a plugin is to the office (contract.ts: briefs, routes, hooks, lead tools), the ones switched on (registry.ts), loading what FOCUS_PLUGINS names (load.ts), and state saved from before (migrate.ts): docs/plugins.md
  github/                 GitHub as an Effect service: gh CLI layer (live), in-memory layer (demo), Promise adapter
  call/                   calls to Number One: gpt-live-1's session and sideband (live.ts), Jev (jev.ts), what the captain asked for (route.ts), how things stand (status.ts) and the briefing on a topic to talk through (brief.ts), all pure, the call's XState machine (machine.ts), a call end to end (calls.ts), the demo's scripted captain (demo.ts)
  agents/
    manager.ts            AgentManager: the office's one way in to its agents; each public method hands over to its part in manager/
    manager/              the manager's parts, each a concern of its own (Effect inside: a fiber per agent's work in a FiberMap)
      core.ts             what they share: store, hub, the runtime and each agent's fiber, rt/update/print; the Part base class; errors
      seating.ts          hire → seat at a desk → start when a slot frees (schedule); sending agents home; a PR landing
      sessions.ts         an agent's Claude Code session: launch, each turn and its hooks, compacting, what follows a turn, failing
      delivery.ts         a developer's work onto GitHub: commit nudge → push → PR, then QA
      conflicts.ts        a PR's merge conflicts: the office's own merge of its base, or an agent seated on it
      leads.ts            goals: start, queue, reopen, close; what a lead hears about their PRs
      slices.ts           a goal's slices: every repo checked out side by side, fresh code when a slice lands, the ship tool
      goalTools.ts        the lead's note, show, explain, ask and propose_close tools, and the captain's answer
      comms.ts            the captain's word with an agent: messages (asking first when picking one up on the API key costs), approvals, stop, effort, reading a lead's turn
      planLimit.ts        your plan's usage limit reached: an agent it stopped carries on with the API key, or is held until it resets
      reviews.ts          QA: the review queue, seating a reviewer, their verdict, sending a failed PR back to be fixed
      triages.ts          stuck PRs: the operations officer's look, one at a time per room, and what they decided
      pluginHost.ts       what the manager lends each plugin (docs/plugins.md): seating an agent on its brief, its state slot, terminal lines and toasts
      cloudMoves.ts       moving an agent to a cloud session, attaching to it, or keeping them local
      ledger.ts           ledger entries, landings, session digests and backfill, the report card
    services.ts           what the manager needs from outside as Effect services: git on the checkouts, Claude Code sessions (a scoped turn), triage
    schedule.ts           who starts next under the office's and each room's limits
    desks.ts              who sits at a room's two individual desks, and who goes home to make room (never a lead or QA)
    claudeRunner.ts       Claude Agent SDK query() in streaming-input mode, permission callback; cloud agents via --cloud; the plan's limit stopping a session; how a session ended (stopped, limited, cloud refused, failed) is pure (`endedOutcome`, `failedOutcome`)
    sdkMessages.ts        each SDK message by type → the run's hooks: lines, activity, helpers, workflows, probes, commits, screenshots, what the key spends, the turn's result
    apiKey.ts             your login or your API key, pure: which a session signs in with, what a re-read costs on the key, ask, hold or go; keyFallback, where the office stands
    cloud.ts              what happens after a cloud agent's session (push nudge, carrying on in a new session, falling back to local when the CLI refuses --cloud), and moving an agent to the cloud
    terminal.ts           the terminal the office opens to start a cloud session (claude --cloud, recorded with script) and finding the session's id in it
    render.ts             SDK messages → Claude-Code-style terminal lines + "what am I doing" text + screenshots in tool results
    tasks.ts              the task list an agent keeps with Claude Code's task tools, followed from its session (TodoWrite, TaskCreate, TaskUpdate, TaskList)
    browserTool.ts        in-process MCP server driving headless Chromium, streams screenshots
    scratch.ts            each local session's scratch dir ($FOCUS_SCRATCH), the office's dcg layer that allows rm -rf in it, and the hook that checks its paths
    wait.ts               the office's bin/ (focus-wait, for waiting on a server, build or log without `sleep N; cmd`) first on each local session's PATH, and the line that tells them so
    agentShell.ts         bash for each local session's Bash tool (CLAUDE_CODE_SHELL), where an unmatched glob isn't zsh's "no matches found"
    workspace.ts          git mirrors (their local base branch kept up with origin's) + worktrees (agents', the per-repo preview checkout, the planner's read-only checkouts), the office's own merge of a PR's base, installing a checkout's dependencies before its agent starts
    conflicts.ts          merge conflicts, pure: the conflicts agent's model, the rules that settle conflicted files without one (.gitattributes), the ledger's line
    planner.ts            the officer at each room's Ops station: issue drafts, their prompt and schema
    lead.ts               each goal's lead: their station, name and branches, their instructions, what shipping a slice does, what they hear back, their helpers
    officeTool.ts         the office's own MCP tools for an agent (the lead's ship)
    explainer.ts          the LCARS player a lead's explainer plays in: their beats and stage wrapped in one page, pure
    studio.ts             the studio computer's tools, pure: the scenes (takes) it stages in the middle of the hall, and retiming them; its instructions
    studioSource.ts       which files a model check may read (checkouts, worktrees, the office's code; a lead's own workspace)
    modelPage.ts          a lead's system model as a page for its station's screen: the three views, stepping and picking by CSS, the cited code carried in it
    modelSchema.ts        a system model as the crew's tools take it (zod), shared by the studio's computer and the leads
    studioComputer.ts     the studio holodeck's computer: one conversation, its turns (ClaudeStudio in claudeCrew.ts, DemoStudio in the demo), and how scenes ran in the room
    numberOne.ts          Number One's ship-wide chat: turns, prompt, reply schema and the ship_status summariser
    claudeCrew.ts         the crew's read-only Claude Code sessions (Read/Glob/Grep, web search/fetch for Number One, Number One's ship_status and open_project, structured output)
    retro.ts              the chief engineer's retro, pure: what the engineer reads (the frictions that keep coming back, the ledger, goals), prompt, schema, and the check that every draft rests on real groups, with the evidence added by code; also who a transcript's message is from
    fakeOffice.ts         a pretend office for tests (the manager's and plugins'): demo GitHub and checkouts, and a Claude Code stand-in whose turns the test ends
    engineer.ts           the chief engineer: groups the digests' frictions, gathers the evidence into data/retros, runs one retro at a time and notes the captain's decisions; also finds the agents' transcripts on disk
    sessionDigest.ts      a session's span digested from its transcript and the ledger, by code: calls, waste, cost, nudges
    frictions.ts          what the retro's reader reads of each session's span, the batches, prompt and schema, the fixed friction kinds, and the check that every quote is in the span
    transcript.ts         reading a Claude Code transcript's lines and blocks, shared by the digests, the friction reader and the studio's timelines
    sessionTimeline.ts    a session told in order for the studio: asks, words, tool runs, and its subagents and workflows (phases, models, most at once, answers), whole or zoomed
    studioSessions.ts     the Claude Code sessions the studio may read (Claude Code's projects folder only): found by what they're about, loaded with their agents' transcripts
    qa.ts                 the QA officer: instructions, the report's schema and parsing, the PR comment
    demoRunner.ts         scripted pretend agents (and a pretend lead, planner, QA officer and Number One) for demo mode
client/src/
  main.ts                 renderer (toon shading + outline pass), loop, interaction, UI wiring
  player.ts               walking, and being carried through a doorway (collision.ts, pure: which moves the colliders allow, never trapping anyone already in one, and sliding someone who comes out of a doorway against its jamb into the opening)
  world/                  ship layout, holodecks, stations, characters, station screens (screenPanes.ts: which panes side by side, and each viewer's switches; paneSwitches.ts and paneSwitchPanel.ts: the briefing room's strip of them under its viewscreen), Kanban display (hologram.ts: a screen floating in the air, see-through where it's dark)
    scenery.ts            stencil "holo walls" that show a landscape built around a training hall (footprint.ts: keeping it out of the hall)
    themes.ts             the landscapes (beach, forest, desert, moon, city, library)
    hallScreens.ts        the plugins' screens round a holodeck's wall (plugins.ts `hall`): a hologram each, drawn when its version changes, E opens it up close
    teamStation.ts        a goal's team station: its door in the holodeck and its briefing room out in the world, the lead's screen, seats for their helpers and the goal's reviewer (helperSeats.ts: who sits where)
    probes.ts             the probes by a lead's chair, one per background command or monitor (probeSlots.ts: which show, and their labels); E on one opens ui/backgroundPanel.ts: its output and Stop
    modelScene.ts         a system model on three hologram boards (structure, sequence, data), the scenario stepping across them
    drawingCanvas.ts      a model drawing painted onto a canvas
    studioHall.ts         the studio holodeck's set: the scene the computer built last, on a round stage in the middle of the hall (takes.ts, built with takeKit.ts), the far wall's hologram saying what it is and how to play it (studio.ts: the stage, and ScenePlayback, the captain's spin, pause, scrub and speed), and the shelf of kept scenes to call back (sceneShelf.ts)
    goalScreens.ts        a team station's holographic sign, LCARS goal board and screen over its pod (goalRoom.ts: how its room stands, how the note fills the board, and what the team's up to at a glance; portraits.ts: the crew's portraits)
    hall.ts               the training hall, each project's holodeck, behind its door's portal: a copy of its shell from Blender (blender/training_hall.py), dressed for its project (hallLayout.ts: where its pods stand, and the door on the deck that leads to it)
    portal.ts             doorways that lead into each other wherever they stand: the far side drawn through the open doors, and walking through (doorway.ts: the geometry)
    transporter.ts        the transporter beam the crew arrive and leave in
    flowHologram.ts       the hologram of a workflow's flow over a transporter room's console: its phases, a key to the pads' colours, their results rising back
    padGlow.ts            the light on each transporter pad under its agent, in their phase's colour
    railMap.ts            a workflow as a rail map, from its roll: stations per phase, a track per item, bundles past eight
    railMapScreen.ts      the rail map drawn on a transporter room's tactical display
    transporterRoom.ts    a team station's transporter room, where a workflow runs: its pads, console (and the screen on it that shows the script), pattern buffer, tactical display and feed camera
    engineering.ts        the engineering station: the engineer, the report card and how their retro stands on the console; E opens their panel
    warpCore.ts           the warp core's glow: the shared materials its 'warp-core' surfaces are drawn with, pulsing
    msd.ts                main engineering's master systems display: a cutaway of the ship with its decks marked, and beside it the ledger's report card, the scorecard, or the trace picked at the table
    numberOne.ts          Number One in the ready room, across the captain's desk (numberOneView.ts: their bubble)
    deck.ts               a deck built in Blender: loads its GLB, draws its surfaces, reads its markers and what pressing E does (deckExtras.ts: what the markers, surfaces and interactions say)
    holodeckDeck.ts       the holodeck deck, put together from its Blender modules for however many holodecks there are
    turbolift.ts          which turbolift stop you're at (the turbolift's controls are in ui/travelPanel.ts)
  ui/                     HUD and panels (agent terminal, a helper's transcript, board, ready room console, teleport, QA station, goals, Comms, the engineering station and its scorecard, the ledger review at main engineering's master systems table)
    frameStats.ts         ?stats=1: how the 3D view runs, top left, and sent to the office each second for its log (frameSamples.ts: the arithmetic; world/gpuTimer.ts: GPU time per pass)
    confirmDialog.ts      the in-game confirm dialog, over whatever panel is open (the Tricorder's buttons ask with it too)
    numberOnePanel.ts     the chat with Number One: the log, suggestions sent to Ops or started as goals, voice mode
    studioChat.ts         the studio's chat with its computer, docked down the right so the room stays in view
    modelPanel.ts         a studio model up close: its three views live as SVG, stepping, and a picked part's cited code
    call.ts               a call to Number One: WebRTC to OpenAI, and the call's strip (what it's doing, what waits on your yes, captions, hang up)
  plugins.ts              the plugins' parts in the browser: each plugins/*/client.ts, shown when the office switched it on
  tricorder/              the phone view at /tricorder (no three.js): home screen, agent drill-down, buttons that survive live re-renders
client/tricorder/index.html   the Tricorder's page (a second Vite entry), with its home-screen meta tags
client/public/tricorder/  its web app manifest and home-screen icons
plugins/                  what the office does beyond its core, a folder per plugin (server.ts, client.ts, shared.ts, its tests and README), switched on by FOCUS_PLUGINS: cartography/ (each project's architecture map, from its repos' .focus/cartography.yaml and their imports), climber/ (main engineering's climber), scorecard/ (main engineering's scorecards, and the scorecard and crap scripts)
client/public/ship/       the decks built in Blender, as GLBs (pnpm run ship writes them, or CI's Ship workflow on a branch, .github/workflows/ship.yml)
blender/                  the Blender scripts that build the decks: ship.py (entry), kit.py (walls, furniture, markers), bake.py (each deck's ambient occlusion, baked into a lightmap), command_deck.py (the bridge, ready room and observation lounge), holodeck_deck.py (the holodecks' hallway and the turbolift), engineering_deck.py (main engineering: the gallery, the well, the warp core and the level below), team_station.py (a team station's door and briefing room), transporter_room.py (a team station's transporter room), training_hall.py (the training hall every holodeck is a copy of)
```

The client mirrors server state over the WebSocket. Every action is a small REST call. Laptop screens and Kanban displays are canvases drawn into textures, and only redrawn when something changes and you can see them (`world/screenRedraw.ts`): close up often enough to follow, with a busy terminal's cursor blinking; further off now and then; out of sight not until they come into view, since each drawing sends the whole canvas to the GPU again. Before you come aboard, `world/warmUp.ts` compiles the whole ship's shaders and sends its baked lighting to the GPU, so the first step into a holodeck or a briefing room doesn't stall; it runs again whenever the world changes (a new holodeck).
