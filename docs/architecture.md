# Architecture

```
shared/types/             types shared by server and client, a file per feature (agents, goals, projects, github, qa, previews, events…) behind index.ts
shared/crew.ts            how the crew look (uniforms, species), and the permanent crew per room (the ops officer, the QA officer), derived from the project id
shared/qa.ts              QA decisions shared by server and board (badges, stale verdicts)
shared/board.ts           a project's Kanban columns (to do, in progress, PRs), for the 3D board, its panel and the Tricorder
shared/agentStatus.ts     how an agent's status reads (icon, one-line status)
shared/tricorder.ts       what needs you (the Tricorder and Comms), which agents are in flight
shared/ledger.ts          the ledger of how work went (QA verdicts, merges, conflicts, triage, goals, session digests): its line format, the check on load, and the report card
server/
  supervise.ts            runs index.ts and restarts it after an auto update
  updater.ts              auto update: fetch, fast-forward, install/build, restart
  index.ts                express + WebSocket (/ws) + Vite middleware (dev) or dist/ (prod)
  office.ts               projects/rooms, Kanban boards (polling GitHub), auto-assign, settings
  store.ts                ~/.focus/state.json + per-agent terminal logs (jsonl) + the ledger (ledger.jsonl)
  ledgerLog.ts            the ledger's one writer: numbered lines flushed to disk, the lock file, repairs and damage on load
  routes.ts               REST API used by the panels
  hub.ts                  broadcasts ServerEvents to every browser tab
  previews.ts             Preview: check a PR out, run the project's preview commands, find its links, tear it down (Effect: one Scope per preview)
  previewMachine.ts       what a preview does to this machine (shell commands in their own process group, signals, probes) as an Effect service
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
      cloudMoves.ts       moving an agent to a cloud session, attaching to it, or keeping them local
      ledger.ts           ledger entries, landings, session digests and backfill, the report card
    services.ts           what the manager needs from outside as Effect services: git on the checkouts, Claude Code sessions (a scoped turn), triage
    schedule.ts           who starts next under the office's and each room's limits
    desks.ts              who sits at a room's two individual desks, and who goes home to make room (never a lead or QA)
    claudeRunner.ts       Claude Agent SDK query() in streaming-input mode, permission callback; cloud agents via --cloud; the plan's limit, and what the key spends
    apiKey.ts             your login or your API key, pure: which a session signs in with, what a re-read costs on the key, ask, hold or go; keyFallback, where the office stands
    cloud.ts              what happens after a cloud agent's session (push nudge, carrying on in a new session, falling back to local when the CLI refuses --cloud), and moving an agent to the cloud
    terminal.ts           the terminal the office opens to start a cloud session (claude --cloud, recorded with script) and finding the session's id in it
    render.ts             SDK messages → Claude-Code-style terminal lines + "what am I doing" text + screenshots in tool results
    tasks.ts              the task list an agent keeps with Claude Code's task tools, followed from its session (TodoWrite, TaskCreate, TaskUpdate, TaskList)
    browserTool.ts        in-process MCP server driving headless Chromium, streams screenshots
    scratch.ts            each local session's scratch dir ($FOCUS_SCRATCH), the office's dcg layer that allows rm -rf in it, and the hook that checks its paths
    workspace.ts          git mirrors + worktrees (agents', the per-repo preview checkout, the planner's read-only checkouts), the office's own merge of a PR's base
    conflicts.ts          merge conflicts, pure: the conflicts agent's model, the rules that settle conflicted files without one (.gitattributes), the ledger's line
    planner.ts            the officer at each room's Ops station: issue drafts, their prompt and schema
    lead.ts               each goal's lead: their station, name and branches, their instructions, what shipping a slice does, what they hear back, their helpers
    officeTool.ts         the office's own MCP tools for an agent (the lead's ship)
    explainer.ts          the LCARS player a lead's explainer plays in: their beats and stage wrapped in one page, pure
    numberOne.ts          Number One's ship-wide chat: turns, prompt, reply schema and the ship_status summariser
    claudeCrew.ts         the crew's read-only Claude Code sessions (Read/Glob/Grep, web search/fetch for Number One, Number One's ship_status and open_project, structured output)
    retro.ts              the chief engineer's retro, pure: what the engineer reads (the frictions that keep coming back, the ledger, goals), prompt, schema, and the check that every draft rests on real groups, with the evidence added by code; also who a transcript's message is from
    engineer.ts           the chief engineer: groups the digests' frictions, gathers the evidence into data/retros, runs one retro at a time and notes the captain's decisions; also finds the agents' transcripts on disk
    sessionDigest.ts      a session's span digested from its transcript and the ledger, by code: calls, waste, cost, nudges
    frictions.ts          what the retro's reader reads of each session's span, the batches, prompt and schema, the fixed friction kinds, and the check that every quote is in the span
    qa.ts                 the QA officer: instructions, the report's schema and parsing, the PR comment
    demoRunner.ts         scripted pretend agents (and a pretend lead, planner, QA officer and Number One) for demo mode
client/src/
  main.ts                 renderer (toon shading + outline pass), loop, interaction, UI wiring
  world/                  ship layout, holodecks, stations, characters, station screens (screenPanes.ts: which panes side by side, and each viewer's switches; paneSwitches.ts and paneSwitchPanel.ts: the briefing room's strip of them under its viewscreen), Kanban display (hologram.ts: a screen floating in the air, see-through where it's dark)
    scenery.ts            stencil "holo walls" that show a landscape built around a training hall (footprint.ts: keeping it out of the hall)
    themes.ts             the landscapes (beach, forest, desert, moon, city, library)
    teamStation.ts        a goal's team station: its door in the holodeck and its briefing room out in the world, the lead's screen, seats for their helpers and the goal's reviewer (helperSeats.ts: who sits where)
    goalScreens.ts        a team station's holographic sign, LCARS goal board and screen over its pod (goalRoom.ts: how its room stands, how the note fills the board, and what the team's up to at a glance; portraits.ts: the crew's portraits)
    hall.ts               the training hall, each project's holodeck, behind its door's portal: a copy of its shell from Blender (blender/training_hall.py), dressed for its project (hallLayout.ts: where its pods stand, and the door on the deck that leads to it)
    portal.ts             doorways that lead into each other wherever they stand: the far side drawn through the open doors, and walking through (doorway.ts: the geometry)
    transporter.ts        the transporter beam the crew arrive and leave in
    engineering.ts        the engineering station: the engineer, the report card and how their retro stands on the console; E opens their panel
    warpCore.ts           the warp core's glow: the shared materials its 'warp-core' surfaces are drawn with, pulsing
    msd.ts                main engineering's master systems display: a cutaway of the ship with its decks marked
    numberOne.ts          Number One in the ready room, across the captain's desk (numberOneView.ts: their bubble)
    deck.ts               a deck built in Blender: loads its GLB, draws its surfaces, reads its markers and what pressing E does (deckExtras.ts: what the markers, surfaces and interactions say)
    holodeckDeck.ts       the holodeck deck, put together from its Blender modules for however many holodecks there are
    turbolift.ts          which turbolift stop you're at (the turbolift's controls are in ui/travelPanel.ts)
  ui/                     HUD and panels (agent terminal, a helper's transcript, board, ready room console, teleport, QA station, goals, Comms, the engineering station)
    confirmDialog.ts      the in-game confirm dialog, over whatever panel is open (the Tricorder's buttons ask with it too)
    numberOnePanel.ts     the chat with Number One: the log, suggestions sent to Ops or started as goals, voice mode
  tricorder/              the phone view at /tricorder (no three.js): home screen, agent drill-down, buttons that survive live re-renders
client/tricorder/index.html   the Tricorder's page (a second Vite entry), with its home-screen meta tags
client/public/tricorder/  its web app manifest and home-screen icons
client/public/ship/       the decks built in Blender, as GLBs (npm run ship writes them, or CI's Ship workflow on a branch, .github/workflows/ship.yml)
blender/                  the Blender scripts that build the decks: ship.py (entry), kit.py (walls, furniture, markers), bake.py (each deck's ambient occlusion, baked into a lightmap), command_deck.py (the bridge, ready room and observation lounge), holodeck_deck.py (the holodecks' hallway and the turbolift), engineering_deck.py (main engineering: the gallery, the well, the warp core and the level below), team_station.py (a team station's door and briefing room), training_hall.py (the training hall every holodeck is a copy of)
```

The client mirrors server state over the WebSocket. Every action is a small REST call. Laptop screens and Kanban displays are canvases drawn into textures, and only redrawn when something changes. Screens near you redraw faster.
