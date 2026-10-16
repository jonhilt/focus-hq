# Architecture

```
shared/types/             types shared by server and client, a file per feature (agents, goals, projects, github, qa, previews, events…) behind index.ts
shared/crew.ts            how the crew look (uniforms, species), and the permanent crew per room (the ops officer, the QA officer), derived from the project id
shared/qa.ts              QA decisions shared by server and board (badges, stale verdicts)
shared/systemModel.ts     the studio's system models: whether one holds together, checking its cites against the code, its timing, and its layered layout
shared/modelDrawing.ts    a system model's three flat views (structure, sequence, data) as shapes, and as SVG
shared/flows.ts           a recorded run's flows between the browser and the office (`pnpm run record-flows`): stack frames to repo files, counting, for net/api.ts and server/flows.ts
shared/board.ts           a project's Kanban columns (to do, in progress, PRs), for the 3D board, its panel and the Tricorder; which PRs the office holds work for have left the board (`prsOffBoard`); each refresh's board from its repos' listings (`freshBoard`) and the closed-PR notes it leaves with nothing to mark (`staleClosedPrs`)
shared/dependencies.ts    issues that wait for others ("Depends on #12"), the order to start them in (`startOrder`), and which ones auto-assign hires an agent for (`issuesToAssign`)
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
  settings.ts             what a change to the captain's settings (PATCH /api/settings, any JSON) leaves them as: fields of the wrong kind ignored, models trimmed, the limit on agents at once kept to 1–32 (pure)
  store.ts                ~/.focus/state.json + per-agent terminal logs (jsonl) + run, review and slice journals (runs/, runs/reviews/, runs/slices/) + the ledger (ledger.jsonl)
  journals.ts             append-only journals of one kind, a file each: numbered facts flushed (fsync) before append returns, folded in memory, a torn last line dropped
  ledgerLog.ts            the ledger's one writer: numbered lines flushed to disk, the lock file, repairs and damage on load
  usage.ts                main engineering's plan usage: read from Claude Code's structured /usage every few minutes, with how the office signs in
  routes.ts               REST API used by the panels
  frameStats.ts           the frame-stats log: what a browser opened with ?stats=1 sends of how its 3D view ran, a file per page load in ~/.focus/frame-stats/
  hostGuard.ts            who the office answers: known Host and Origin only (DNS rebinding, other sites' pages), for /api, pages and /ws
  hub.ts                  broadcasts ServerEvents to every browser tab
  flows.ts                with FOCUS_FLOWS set, counts each event the hub sends and each /api request against the files that sent them, handed over at GET /api/flows
  previews.ts             Preview: check a PR out, run the project's preview commands, find its links, tear it down (Effect: one Scope per preview)
  previewMachine.ts       what a preview does to this machine (shell commands in their own process group, signals, probes) as an Effect service
  previewResults.ts       what its commands print means: the last JSON result, which stack in a list is ours and when it's gone, the phase, links and logs it gives (pure)
  previewVerdicts.ts      what a running preview's health checks and its start command's exit mean (pure)
  plugins/                what a plugin is to the office (contract.ts: briefs, routes, hooks, lead tools), the ones switched on (registry.ts), loading what FOCUS_PLUGINS names (load.ts), and state saved from before (migrate.ts): docs/plugins.md
  github/                 GitHub as an Effect service: gh CLI layer (live), in-memory layer (demo), Promise adapter
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
      pluginHost.ts       what the manager lends each plugin (docs/plugins.md): seating an agent on its brief, its state slot, the office's agents and their transcripts, terminal lines and toasts
      cloudMoves.ts       moving an agent to a cloud session, attaching to it, or keeping them local
      ledger.ts           ledger entries, landings, session digests and backfill, the report card
    services.ts           what the manager needs from outside as Effect services: git on the checkouts, Claude Code sessions (a scoped turn), triage
    schedule.ts           who starts next under the office's and each room's limits
    desks.ts              who sits at a room's two individual desks, and who goes home to make room (never a lead or QA)
    claudeRunner.ts       Claude Agent SDK query() in streaming-input mode, permission callback; cloud agents via --cloud; the plan's limit stopping a session; how a session ended (stopped, limited, cloud refused, failed) is pure (`endedOutcome`, `failedOutcome`)
    sdkMessages.ts        each SDK message by type → the run's hooks: lines, activity, helpers, workflows, probes, commits, screenshots, what the key spends, the turn's result
    reviewJournal.ts      each pull request's QA review journal, pure: its facts from requested to the verdict posted and announced (data/runs/reviews/<pr>.jsonl, written by Store.reviewJournal), what they add up to as an XState machine (reviewMachine), and what a restart does with a review under way
    runJournal.ts         each agent's run journal, pure: the facts of its turns, phases and inbox (data/runs/<agent>.jsonl, written by Store.journal before the office acts), what they add up to as an XState machine (journalMachine: facts are events, the run's phase its state), the sign-in check, and what a restart does with a turn in flight or a run waiting for a slot
    sliceJournal.ts       each goal's slice journal, pure: its facts as a slice ships, lands and moves to fresh code (data/runs/slices/<lead>.jsonl, written by Store.sliceJournal), what they add up to as an XState machine (sliceMachine), and what a restart finishes
    inbox.ts              an agent's inbox, kept in their run journal
    runMachine.ts         what follows a turn, as an XState state machine: the state it ran in (local, cloud, attaching), the event its end was (read from its outcome once), guarded transitions handing what a state doesn't take up to its parent; `step` takes one with XState's pure `transition`
    statechart.ts         an XState machine drawn as a Mermaid statechart, from the machine itself: for docs pages and a lead's station screen
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
    shipStatus.ts         the ship as the crew's ship_status tool tells it, trimmed hard (summariseShip, each closed goal's PRs looked up on GitHub): the studio's computer reads it, and plugins through host.shipStatus
    claudeCrew.ts         the crew's read-only Claude Code sessions (runReadOnly: Read/Glob/Grep, web search/fetch where given, structured output), and the ship tools (ship_status, open_project) the studio's computer and plugins' crew share
    fakeOffice.ts         a pretend office for tests (the manager's and plugins'): demo GitHub and checkouts, and a Claude Code stand-in whose turns the test ends
    sessionDigest.ts      a session's span digested from its transcript and the ledger, by code: calls, waste, cost, nudges
    transcript.ts         reading a Claude Code transcript: finding the agents' on this machine, its lines and blocks, and who a message is from; shared by the digests, the studio's timelines and plugins (the retro's friction reader)
    sessionTimeline.ts    a session told in order for the studio: asks, words, tool runs, and its subagents and workflows (phases, models, most at once, answers), whole or zoomed
    studioSessions.ts     the Claude Code sessions the studio may read (Claude Code's projects folder only): found by what they're about, loaded with their agents' transcripts
    qa.ts                 the QA officer: instructions, the report's schema and parsing, the PR comment
    demoRunner.ts         scripted pretend agents (and a pretend lead, planner and QA officer) for demo mode, and the made-up files of its repos
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
    goalScreens.ts        a team station's holographic sign, LCARS goal board (with the plugins' strips along its bottom) and screen over its pod (goalRoom.ts: how its room stands, how the note fills the board, and what the team's up to at a glance; portraits.ts: the crew's portraits)
    hall.ts               the training hall, each project's holodeck, behind its door's portal: a copy of its shell from Blender (blender/training_hall.py), dressed for its project (hallLayout.ts: where its pods stand, and the door on the deck that leads to it)
    portal.ts             doorways that lead into each other wherever they stand: the far side drawn through the open doors, and walking through (doorway.ts: the geometry)
    transporter.ts        the transporter beam the crew arrive and leave in
    flowHologram.ts       the hologram of a workflow's flow over a transporter room's console: its phases, a key to the pads' colours, their results rising back
    padGlow.ts            the light on each transporter pad under its agent, in their phase's colour
    railMap.ts            a workflow as a rail map, from its roll: stations per phase, a track per item, bundles past eight
    railMapScreen.ts      the rail map drawn on a transporter room's tactical display
    transporterRoom.ts    a team station's transporter room, where a workflow runs: its pads, console (and the screen on it that shows the script), pattern buffer, tactical display and feed camera
    engineering.ts        the engineering station: the engineer, the report card on the console, and what a plugin has them busy with (the station part); E opens their panel
    warpCore.ts           the warp core's glow: the shared materials its 'warp-core' surfaces are drawn with, pulsing
    msd.ts                main engineering's master systems display: a cutaway of the ship with its decks marked, and beside it the ledger's report card, the scorecard, or the trace picked at the table
    shipParts.ts          the plugins' parts of the ship (ClientPlugin.ship), one that throws left out; the World builds them after the decks, lending a seat, a mount, colliders and E
    deck.ts               a deck built in Blender: loads its GLB, draws its surfaces, reads its markers and what pressing E does (deckExtras.ts: what the markers, surfaces and interactions say)
    holodeckDeck.ts       the holodeck deck, put together from its Blender modules for however many holodecks there are
    turbolift.ts          which turbolift stop you're at (the turbolift's controls are in ui/travelPanel.ts)
  ui/                     HUD and panels (agent terminal, its run replayed from the journal (runReplay.ts), a helper's transcript, board, ready room console, teleport, QA station, goals, Comms, the engineering station and its scorecard, the ledger review at main engineering's master systems table)
    frameStats.ts         ?stats=1: how the 3D view runs, top left, and sent to the office each second for its log (frameSamples.ts: the arithmetic; world/gpuTimer.ts: GPU time per pass)
    confirmDialog.ts      the in-game confirm dialog, over whatever panel is open (the Tricorder's buttons ask with it too)
    studioChat.ts         the studio's chat with its computer, docked down the right so the room stays in view
    modelPanel.ts         a studio model up close: its three views live as SVG, stepping, and a picked part's cited code
  plugins.ts              the plugins' parts in the browser: each plugins/*/client.ts, shown when the office switched it on (the engineering station's cards, views and what its engineer says, the MSD's boards, their words on each goal: goalTags, goalStrips; what each starts once with its keys and legend, and its part of the ship)
  tricorder/              the phone view at /tricorder (no three.js): home screen, agent drill-down, buttons that survive live re-renders
client/tricorder/index.html   the Tricorder's page (a second Vite entry), with its home-screen meta tags
client/public/tricorder/  its web app manifest and home-screen icons
plugin-api/               all a plugin may import of the office: shared.ts, server.ts (the contract, PluginHost), client.ts (ClientPlugin, office, callPlugin, the UI kit), testing.ts (the fake office), and boundary.ts, the line its test holds every import to: docs/plugins.md
plugins/                  what the office does beyond its core, a folder per plugin (server.ts, client.ts, shared.ts, its tests and README), switched on by FOCUS_PLUGINS (all: every one): cartography/ (each project's architecture map, from its repos' .focus/cartography.yaml and their imports, TypeScript and Java), climber/ (main engineering's climber), flow/ (where each goal's time goes, on its goal board, card and Comms line, and the flow and before-after scripts), number-one/ (Number One in the ready room: the chat, voice mode, the figure, the 1 key, and calls through gpt-live-1, Jev and an XState machine), retro/ (the chief engineer's retro: frictions read from the agents' sessions, drafts filed on the captain's word, its Retro view), scorecard/ (main engineering's scorecards, and the scorecard and crap scripts)
client/public/ship/       the decks built in Blender, as GLBs (pnpm run ship writes them, or CI's Ship workflow on a branch, .github/workflows/ship.yml)
blender/                  the Blender scripts that build the decks: ship.py (entry), kit.py (walls, furniture, markers), bake.py (each deck's ambient occlusion, baked into a lightmap), command_deck.py (the bridge, ready room and observation lounge), holodeck_deck.py (the holodecks' hallway and the turbolift), engineering_deck.py (main engineering: the gallery, the well, the warp core and the level below), team_station.py (a team station's door and briefing room), transporter_room.py (a team station's transporter room), training_hall.py (the training hall every holodeck is a copy of)
```

The client mirrors server state over the WebSocket. Every action is a small REST call. Laptop screens and Kanban displays are canvases drawn into textures, and only redrawn when something changes and you can see them (`world/screenRedraw.ts`): close up often enough to follow, with a busy terminal's cursor blinking; further off now and then; out of sight not until they come into view, since each drawing sends the whole canvas to the GPU again. Before you come aboard, `world/warmUp.ts` compiles the whole ship's shaders and sends its baked lighting to the GPU, so the first step into a holodeck or a briefing room doesn't stall; it runs again whenever the world changes (a new holodeck).
