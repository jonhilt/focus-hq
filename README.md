# 🏢 Welcome to the USS Focus

A cartoon, first-person 3D starship where a crew of **Claude Code** agents works through your GitHub issues, and you're the captain.

![A project holodeck: a round training hall on a beach, the Kanban display curving round the far wall, team pods round the walls with their screens over them, and the crew at their stations in the middle](docs/room.jpg)

| Over an agent's shoulder | The board up close |
| --- | --- |
| ![Live terminal and browser on an agent's station](docs/station.jpg) | ![Kanban panel with issues, agents and PRs](docs/board.jpg) |

- The office is a **starship** in the style of *Star Trek: Lower Decks*: bulkhead corridors, LCARS signs and consoles, viewports onto space (with stars drifting past as the ship cruises), doors that swoosh open as you walk up, and the engines' thrum underneath it all (mute it from the pause menu).
- Every **project** gets a **holodeck**. A project can span several GitHub repositories. Through its door on the deck is a round training hall, far bigger than the door's slot, with the board round the far wall and the team stations' pods round the walls.
- Each holodeck runs a **program**: its walls and ceiling vanish into a landscape, so the stations sit on a beach, in a forest clearing, in a desert canyon, on the moon, on a city rooftop at dusk or in a vast library. A faint holodeck grid shows where the walls are when you get close. Pick one per project in your **ready room**, or keep the plain holodeck grid. Empty holodecks are bare, with the holodeck grid.
- Every **agent** is a separate Claude Code instance (via the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk)) with its own workstation and git worktree. The crew wear Starfleet uniforms in their division's colour (command red, operations gold, sciences blue) and come from all over the Federation. They **beam in** to their station when they're assigned and beam out when they go home: a shimmering column of sparkles, the transporter's hum if you're in the room.
- Walk up behind an agent and you see their **station's display**: the live Claude Code terminal and, while they test, the **browser** they are driving.
- Each holodeck works on up to four **goals** at once, each with a **lead** of its own at a **team station**: your own Claude Code session for that goal, with every one of the project's repos checked out side by side. Each station is a holo-pod round the holodeck's wall, and through it the goal's briefing room, far bigger than the holodeck could hold: a mini bridge, with nothing between the door and the lead's session on a big screen across the far wall: the lead and the goal's QA reviewer sit either side of where you stand, and their helpers at two curved consoles round behind. You walk straight in: the open door shows the room beyond, and you step through without a cut. Two individual desks in the middle of the holodeck take quick issue work. Talk the goal through with them, and they build it a slice at a time, the way you'd work in Claude Code. Each slice ships as a pull request in every repo it touches; QA reviews them, you merge them, and the lead carries on from what the slice taught you.
- Each holodeck has an **operations officer** at its **Ops** station. Give them a rough idea and they read the project's code and write it up as an issue with context and **acceptance criteria**, ready for you to edit and file.
- Each holodeck's **Kanban display** shows what's to do, the goals under way and who's working on what, and which **pull requests** are ready to merge.
- The captain's **ready room** is where you create projects, connect existing repos or create blank ones, file issues and tune how much the agents may do on their own.
- **Hide** a project there to keep it out of sight while you demo the office. Its holodeck keeps its place behind locked doors under a *Holodeck in use* sign, and no other room moves or takes its place. Its name, board, crew, toasts and totals show nowhere aboard (the Tricorder and Number One included), while its crew keep working. In the ready room's list it shows only as *Hidden project* with its holodeck number; **👁 Show it** brings it back.
- When an agent is done, Focus pushes their branch and opens a **pull request** with their summary as the description. Merge it from the board and they pack up and go home.
- Each holodeck has a **QA officer** at the QA station. Pull requests waiting for you pile up as **PADDs** on a rack by the door (the crew hand each other a PADD rather than share a file). They review and test every PR the crew opens (code review, tests, the browser) and post a **QA report** on it. The board shows the verdict next to each PR.
- Press **Preview** on any open pull request to run it on your machine and open it in **your own browser** before you merge.

GitHub goes through the [`gh` CLI](https://cli.github.com/). Claude runs through the Agent SDK on **your own Claude login**, so agents use your Claude subscription.

## Quick start

```bash
npm install
npm run demo        # fake GitHub + pretend agents, nothing to set up
```

Open <http://127.0.0.1:4477>, click **Come aboard**, and walk around ([controls](docs/controls.md)).

### Take the code tour

To see how it works, open the repo in VS Code and take the guided tour. It follows one agent from the GitHub issue you assign them, through their Claude Code session, to the pull request, QA's report and the merge, a step at a time in the code. VS Code offers to install the [CodeTour](https://marketplace.visualstudio.com/items?itemName=vsls-contrib.codetour) extension it needs; once it's in, the tour starts from the CodeTour panel in the Explorer (or **CodeTour: Start Tour** in the command palette). Keep `npm run demo` running beside it to watch each step happen.

### The real thing

Prerequisites:

1. **Node.js 20+**
2. **GitHub CLI**, signed in: `gh auth login`
3. **Claude Code**, signed in with your subscription: run `claude` once and `/login`, or set `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`.
4. *(optional, for browser testing)* `npx playwright install chromium`. Without it, agents fall back to your installed Chrome or Edge.

```bash
npm run dev         # live mode with hot reload for the 3D client
# or
npm run build && npm start
```

Then on board:

1. Walk into your **ready room**, off the bridge to port (or press <kbd>M</kbd>) → **New project**. Connect repositories (`owner/name` or a URL), or switch on *A new, blank repository on GitHub too*.
2. A new holodeck appears down the corridor. Its Kanban display fills with the repos' open issues.
3. At the board (<kbd>E</kbd>), click **Assign agent** on an issue, or file one at the **Ops** station (<kbd>N</kbd>) and leave *Assign an agent right away* on. The officer at Ops can draft it for you from a one-liner (see [Drafting issues](docs/drafting-issues.md)). The 🧠 picker beside either sets how much effort the agent puts in (`low` to `max`; *default* leaves it to the model).
4. Watch them work. Press <kbd>E</kbd> on an agent or their station to open the full terminal, message them, or approve something they need.
5. When the PR shows up under **Ready to merge**, the holodeck's QA officer tests it and posts their report on it. Press **Preview** to try it yourself, review it on GitHub and merge it from the board.

> **Subscription note:** if `ANTHROPIC_API_KEY` is set, agents ignore it and use your Claude login. Set `FOCUS_USE_API_KEY=1` if you want them on the API key instead. Each agent is a full Claude Code session, so several at once use your plan's limits faster. **Settings → Agents working at once** caps that (default 4).

## Docs

**Using the ship**

- [Controls](docs/controls.md): keys and what they do
- [Goals and their leads](docs/goals.md): team stations, briefing rooms, shipping a goal a slice at a time
- [Comms](docs/comms.md): who's waiting on you across the ship, and answering them from anywhere
- [Drafting issues](docs/drafting-issues.md): the operations officer at the Ops station
- [Number One](docs/number-one.md): the ship-wide chat in the ready room, and its voice mode
- [How an agent works an issue](docs/agents.md): from hire to merge, their panel and station displays
- [Cloud agents](docs/cloud-agents.md): agents in Claude Code cloud sessions
- [QA](docs/qa.md): the QA officer, reports, send-back, auto-merge and stuck PRs
- [Previewing a pull request](docs/previews.md): preview commands, placeholders and links
- [Autonomy](docs/autonomy.md): how much agents may do without asking
- [Voice input](docs/voice-input.md): the Mic buttons and whisper.cpp
- [On your phone (Tricorder)](docs/tricorder.md): the phone view, over Tailscale

**Running the office**

- [Configuration](docs/configuration.md): environment variables
- [Your API key when your plan runs out](docs/api-key.md): carrying on with `ANTHROPIC_API_KEY` while your plan's usage limit is reached
- [Data and backups](docs/data.md): what lives in `~/.focus/` and what to back up
- [The ledger](docs/ledger.md): the log of how work went, and the report card
- [The chief engineer's retro](docs/retro.md): a look back over the agents' sessions, with proposals for how the office works
- [Auto update](docs/auto-update.md): keeping the office on the latest code

**Working on Focus**

- [Architecture](docs/architecture.md): a map of the code
- [Scripts](docs/scripts.md): the npm scripts
- [CLAUDE.md](CLAUDE.md): commands and conventions for the agents building Focus
- [Goals plan](docs/goals-plan.md) and [Effect assessment](docs/effect-assessment.md): design notes

## Licence

Source-available for members of the AI Coding Lab community: see [LICENSE](LICENSE). Not open source, so please don't republish it.
