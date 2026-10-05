# 🏢 Focus HQ

A cartoon, first-person 3D starship where a crew of **Claude Code** agents works through your GitHub issues, and you're the captain.

![A project holodeck: agents at their stations, the Kanban display on the back wall](docs/room.jpg)

| Over an agent's shoulder | The board up close |
| --- | --- |
| ![Live terminal on an agent's laptop](docs/laptop.jpg) | ![Kanban panel with issues, agents and PRs](docs/board.jpg) |

- The office is a **starship** in the style of *Star Trek: Lower Decks*: bulkhead corridors, LCARS signs and consoles, viewports onto space (with stars drifting past as the ship cruises), doors that swoosh open as you walk up, and the engines' thrum underneath it all (mute it from the pause menu).
- Every **project** gets a **holodeck**. A project can span several GitHub repositories.
- Each holodeck runs a **program**: its walls and ceiling vanish into a landscape, so the stations sit on a beach, in a forest clearing, in a desert canyon, on the moon, on a city rooftop at dusk or in a vast library. A faint holodeck grid shows where the walls are when you get close. Pick one per project in your **ready room**, or keep the plain holodeck grid. Empty holodecks are bare.
- Every **agent** is a separate Claude Code instance (via the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk)) with its own station, laptop and git worktree. The crew wear Starfleet uniforms in their division's colour (command red, operations gold, sciences blue) and come from all over the Federation.
- Walk up behind an agent and you see their **laptop screen**: the live Claude Code terminal and, while they test, the **browser** they are driving.
- Each holodeck has an **operations officer** at its **＋ New issue** stand. Give them a rough idea and they read the project's code and write it up as an issue with context and **acceptance criteria**, ready for you to edit and file.
- Bigger or fuzzier ideas go to a **briefing** in the **observation lounge** behind the ready room. The officer reads the code, grills you one question at a time and keeps a brief on the wall screen. When you wrap up, they write one issue to the holodeck's stand.
- Each holodeck's **Kanban display** shows what's to do, who's working on what, and which **pull requests** are ready to merge.
- The captain's **ready room** is where you create projects, connect existing repos or create blank ones, file issues and tune how much the agents may do on their own.
- When an agent is done, Focus pushes their branch and opens a **pull request** with their summary as the description. Merge it from the board and they pack up and go home.
- Each holodeck has a **QA officer** at the pull requests table. They review and test every PR the crew opens (code review, tests, the browser) and post a **QA report** on it. The board shows the verdict next to each PR.
- Press **▶ Preview** on any open pull request to run it on your machine and open it in **your own browser** before you merge.

GitHub goes through the [`gh` CLI](https://cli.github.com/). Claude runs through the Agent SDK on **your own Claude login**, so agents use your Claude subscription.

## Quick start

```bash
npm install
npm run demo        # fake GitHub + pretend agents, nothing to set up
```

Open <http://127.0.0.1:4477>, click **Come aboard**, and walk around.

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

1. Walk north into your **ready room** (or press <kbd>M</kbd>) → **New project**. Connect repositories (`owner/name` or a URL), or tick *create a new blank repository*.
2. A new holodeck appears down the corridor. Its Kanban display fills with the repos' open issues.
3. At the board (<kbd>E</kbd>), click **Assign agent** on an issue, or file one at the **＋ New issue** stand and tick *Assign an agent right away*. The officer at the stand can draft it for you from a one-liner (see [Drafting issues](#drafting-issues)). The 🧠 picker beside either sets how much effort the agent puts in (`low` to `max`; *default* leaves it to the model).
4. Watch them work. Press <kbd>E</kbd> on an agent or laptop to open the full terminal, message them, or approve something they need.
5. When the PR shows up under **Ready to merge**, the holodeck's QA officer tests it and posts their report on it. Press **▶ Preview** to try it yourself, review it on GitHub and merge it from the board.

> **Subscription note:** if `ANTHROPIC_API_KEY` is set, agents ignore it and use your Claude login. Set `FOCUS_USE_API_KEY=1` if you want them on the API key instead. Each agent is a full Claude Code session, so several at once use your plan's limits faster. **Settings → Agents working at once** caps that (default 4).

## Controls

| Key | Action |
| --- | --- |
| <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / mouse | walk / look |
| <kbd>Shift</kbd> | run |
| <kbd>E</kbd> or click | use whatever is under the crosshair (agent, laptop, board, PR table, kiosk, console) |
| <kbd>T</kbd> | teleport to any holodeck or straight to an agent's station |
| <kbd>M</kbd> | ready room |
| <kbd>N</kbd> | new issue for the holodeck you're in |
| <kbd>Esc</kbd> | pause / close a panel |

## Drafting issues

Every holodeck has an operations officer sitting at its **＋ New issue** stand (<kbd>E</kbd> on them, or <kbd>N</kbd> anywhere on the holodeck). The officer is the same person every time; their name comes from the project.

1. Type a rough idea ("let shoppers save items for later from the cart") and press **✨ Draft it**. You can close the panel and walk off. Their speech bubble shows what they're reading.
2. The officer reads the project's repositories and writes an issue: a title, **Context** (naming the files involved), **What to build**, **Acceptance criteria** as a checklist, **Out of scope** and any **Assumptions**. They also pick which of the project's repos it belongs in.
3. The draft fills the form's fields. Edit it however you like, or tell them what to change and press **↻ Redraft**. A redraft continues their last session, so they don't read the code all over again.
4. **📌 Pin it to the board** files it as usual. Filing it, or **✕ Discard draft**, clears the stand.

The officer never files, pushes or edits anything. They run as a Claude Code session with only `Read`, `Glob` and `Grep`, in `dontAsk` mode, with no settings, hooks or MCP servers loaded. They read up-to-date checkouts of the project's default branches in `~/.focus/planning/<project>/`. A draft lives in memory only, so it's lost if the office restarts. Drafting sessions don't count towards **Agents working at once**.

### Briefings

For anything bigger or fuzzier than a one-line issue, press **📣 Call a briefing** at the stand instead of **✨ Draft it**. You can also call one from the observation lounge itself, through the door in the north wall of the ready room. You're beamed to the lounge, and the officer leaves the stand and sits down across the table from you.

1. The officer reads the code, puts a first brief on the wall screen and asks their first question.
2. They ask one question at a time, starting with the why (who it's for, what's going wrong, what success looks like), then the what. They check the code before asking, and they suggest an answer with each question so you can just say yes.
3. The brief on the wall screen (and in the panel) keeps up as you go: **Why**, **Who for**, **Scope**, **Out of scope**, **Acceptance criteria** and **Open questions**.
4. **📋 Wrap up** when you're happy. The officer writes one issue, with the why from the briefing in its Context, and leaves it at the project's stand as a normal draft. A redraft there carries on from the whole briefing.
5. **✕ End briefing** sends them back to the stand. Only one briefing runs at a time.

In a briefing the officer can also search and read the web (`WebSearch`, `WebFetch`) for things the code can't answer, like library versions or migration guidance, and tells you where they found it. They still can't change anything.

A briefing is saved in `~/.focus/state.json` with the officer's session, and each turn resumes that session. Nothing runs while it's your turn, and you can pick a briefing back up after a restart.

## How an agent works an issue

1. **Hire**: the agent gets a station on the project's holodeck and a name. If the office is at its concurrency limit, they wait in the queue (⏳).
2. **Set up**: `~/.focus/repos/<owner>__<name>` holds one clone per repository. The agent gets a fresh `git worktree` of it on a new branch `focus/<issue>-<slug>-<id>`, so agents never step on each other.
3. **Work**: Claude Code runs in that worktree with the issue (title, body, labels, comments) as its task. It also gets a few instructions: commit as you go, don't push, run the tests, check UI changes in the browser, and write the final message as a PR description.
4. **Browser testing**: agents get an in-process MCP server (`mcp__browser__open/click/type/press/screenshot/evaluate/console`) backed by headless Chromium. Every action's screenshot streams to their laptop screen.
5. **Deliver**: if they left uncommitted changes, they're asked once to commit them. Then the office pushes the branch and opens the PR (`Closes #N`) with the agent's summary as the body.
6. **Follow-ups**: message an agent at any time. While they're working, the message reaches them at their next step. Once they're done, the message resumes the same Claude session and the new commits update the PR.
7. **Merge conflicts**: a conflicting PR gets a **🔧 Resolve conflicts** button on the board. The agent who opened it merges the base branch in and updates the PR. If nobody in the office owns the PR (a teammate's, or the agent already went home), a new agent sits down on the PR's branch to do it.
8. **QA**: every PR the office opens or updates goes to the holodeck's QA officer (see [QA](#qa)).
9. **Merged**: when the PR is merged (from the board or on GitHub), the agent leaves and their worktree is cleaned up.

### Cloud agents

The **💻 local / ☁ cloud** picker next to 🧠 (on **Assign agent**, and at the New issue stand) puts an agent in a [Claude Code cloud session](https://code.claude.com/docs/en/claude-code-on-the-web) instead of on your machine. They still get a station and a laptop, and the office still opens the PR and hands it to QA.

- **How it runs:** through the Agent SDK's bundled CLI with `--cloud`, which starts the cloud session and relays it in the same message stream as a local agent, so their terminal is live as usual. The laptop panel links to the session on claude.ai (**Cloud session ↗**), where you can watch or steer it too.
- **When Claude Code won't start one:** the CLI starts a new cloud session headlessly only while Anthropic has its headless cloud client switched on for your account, a server-side rollout with no flag or SDK option to request it. Otherwise it refuses with "--cloud requires an interactive terminal", and the agent carries on as a 💻 local agent in the worktree the office already set up: one line in their terminal says so, the ☁ chip and **Cloud session ↗** link go, and the PR, QA and later follow-ups work as for any local agent. ☁ stays on offer, since Anthropic can switch headless cloud sessions on at any time.
- **Their branch:** the office publishes `focus/<issue>-<slug>-<id>` to GitHub first (the cloud session clones it from there), and the agent is told to commit and push to that branch, and only that one, with `git push origin HEAD:<branch>`. When the session ends, the office fetches the branch and opens the PR. If nothing new arrived, the agent is asked once to push.
- **Screenshots:** the office's browser tool runs on your machine, so cloud agents test in the cloud machine's own browser instead (a Playwright script, say). Any screenshot they look at comes back in their tool results and shows on their laptop screen, like a local agent's browser.
- **Follow-ups** reattach to the same cloud session (`--cloud <session id>`). If that fails (an archived session, say), a new cloud session picks the work up from the branch with your message. If Claude Code refuses to start that one, the office fetches the branch into the worktree first, so nothing the cloud session pushed is lost, and the agent carries on locally with your message.
- **Stop** interrupts the cloud session's turn before letting go of it.
- The QA officer always works locally: QA needs the office browser for its screenshots.

You need a claude.ai login (not `FOCUS_USE_API_KEY`) and GitHub connected for cloud sessions: install the [Claude GitHub App](https://github.com/apps/claude) on the repo, or run `/web-setup` in Claude Code. Without the app, the CLI uploads the worktree instead of cloning. On Team and Enterprise plans, an admin has to allow cloud sessions. Cloud agents count towards **Agents working at once**: they share your plan's limits. The cloud session works in your [cloud environment](https://code.claude.com/docs/en/cloud-environments) (network access, setup script), not with your local tools. The headless `--cloud` mode the office drives isn't documented by Anthropic yet, so a Claude Code update can change how it behaves.

## QA

Every holodeck has a QA officer in blue, sitting at the pull requests table facing the board, with a laptop you can look at over their shoulder.

- **When they test:**
  - Automatically, when the office opens a PR or pushes new commits to one. Turn this off per project at the QA station.
  - Whenever you press **🔍 Send to QA** (or **↻ Re-test**) on a PR on the board, a teammate's PR included.
- **One at a time:** reviews queue up for the holodeck's officer. QA counts towards **Agents working at once**, but goes ahead of new issues in the queue and doesn't take one of the holodeck's agent slots.
- **What they do:**
  1. Check the PR's head out, detached, into their own folder.
  2. Read the PR and its linked issues, and work out the acceptance criteria.
  3. Review the diff against the base branch.
  4. Run the tests, type checks, linters and build.
  5. Click through UI changes with the browser tool, so you see that on their laptop.
  6. Finish with a structured report: a verdict, a summary, every check made, the commands run and, on a fail, fix instructions.
- **The report:** the office posts it as a comment on the PR (QA never touches GitHub themselves), and the board shows **✅ QA passed**, **❌ QA failed** or, once newer commits land, **QA passed an older commit**. You still merge.
- **Screenshots:** the last 8 screenshots QA takes on purpose (`mcp__browser__screenshot`) go with the report, each with QA's caption. The office commits them to an orphan branch in the PR's repo, `focus-qa-evidence` (created on first use, no shared history with the code, never merged), and embeds them in the comment. A screenshot that fails to upload is left out of the comment and the error shows in QA's terminal.
- **The QA station** (<kbd>E</kbd> on the officer when they're free, or the QA chip on a PR):
  - every report in full, with its screenshots;
  - the auto-QA and send-back switches;
  - the project's **QA brief**: what to check on every PR of this project ("works at phone width", "no console errors"). It goes into the officer's instructions on every review.
- **Sending a failed PR back:** when QA fails a PR the office opened, the office hands QA's summary and fix instructions to the developer who opened it. If they've gone home, a new agent sits down on the PR's branch, fixes it and pushes to the same PR. The fix goes back to QA by itself, and the re-test is told last round's findings and the commit it tested, so it checks those first, then what changed since, plus a quick smoke test.
  - After 3 failed rounds, or a fix that pushes nothing, the office stops: the PR card and the Kanban display show **🙋 needs you**, and a toast says why.
  - Teammates' PRs are never sent back. Turn send-back off per project at the QA station.
- **Following up:** message the QA officer like any agent, to have them look at something else.

## Previewing a pull request

Every PR card under **Ready to merge** (and a finished agent's panel) has a **▶ Preview** button. Each project has one preview at a time: previewing another PR replaces it.

1. The PR's head (`refs/pull/<n>/head`, so teammates' and forks' PRs work too) is checked out in `~/.focus/previews/<project>/<repo>`. Any other repo of the project that the preview commands mention (`{dir:<repo>}`) is checked out next to it at its default branch. The checkouts are reused from one preview to the next, so `node_modules`, `bin/obj` and other ignored build output stick around.
2. The project's **preview command** runs in the PR's checkout. Set it in the ready room (**Projects → ▶ Preview**). Leave it empty and the office runs `npm install && npm run dev` in the PR's repo (or the `start` script, with pnpm/yarn/bun if the repo has their lockfile).
3. The links come from the command's output: a JSON object with `urls` (`{"urls": {"web": "http://127.0.0.1:55686", "api": "…"}}`, a list, or a single `url`) becomes named links, web front ends before APIs. Otherwise every local URL it prints (`http://localhost:5173/`…) becomes a link. If it prints neither, the office waits for the free port it offered.
4. You get a toast with **Open ↗** once a site answers. The preview panel shows the command's output and a tab for each log file in the folder its JSON reported as `logs` (lines mentioning errors or failures are highlighted). It also shows the links with their last health check (⚠ when a site stops answering or answers with a 5xx), **Restart** (e.g. after the agent pushed more commits; the card says when the preview is behind) and **Stop**.

| Command | |
| --- | --- |
| **Start** | Brings the site(s) up. It can stay in the foreground like a dev server, or exit once its sites are up in the background. In that case the office keeps checking that the sites still answer. If it reported its URLs as JSON and exits non-zero without saying `failed`, `error` or `stopped` (e.g. `"status": "unhealthy"`), the preview still comes up as long as one of its sites answers within 30 seconds, with a ⚠ warning. Otherwise a JSON `error` in its output (or its `status` and exit code) becomes the failure message. |
| **Stop** *(optional)* | Tears down whatever **Start** left running, like containers and background servers. It runs on **Stop**, when a preview fails, when the PR is merged or closed, when the office shuts down, and before every start, so a stack left over from a crash is never reused. After it, the office kills whatever is left of the start command's process tree. A failed preview stays on screen with its output and logs until you dismiss it. |
| **Progress** *(optional)* | Polled every 5 seconds while starting. Only its JSON output counts, not its exit code. That's either this stack's state, or a list of stacks (`{"sessions": [...]}`) where this preview's is the one that mentions its checkout paths. The `phase` shows as progress ("Starting – database-migrate"), and once the preview is up its `status` drives the ⚠ warning (`unhealthy`, then gone again at `ready`). A list is the more reliable choice: if a stack it listed drops out while still starting, whatever was running it has died, and the preview fails within about 10 seconds instead of waiting for the start command to time out. The same goes for a running stack that drops out of the list. A start command can also print JSON lines with a `phase` itself. |

| Placeholder | |
| --- | --- |
| `{dir}` | the PR's checkout (also the working directory) |
| `{dir:<repo>}` | that repo's checkout (name or owner/name): the PR's code if the PR is in it, its default branch otherwise |
| `{port}`, `$FOCUS_PREVIEW_PORT` | a free port |
| `{pr}`, `{repo}` | the PR number and owner/name |

`PORT` is only set for the auto-detected npm command, so a CLI that starts several sites doesn't hand them all one port.

A project whose API, web app and admin app live in three repos and come up with one script might use:

```
Start     {dir:shop-api}/scripts/stack up --api {dir:shop-api} --web {dir:shop-web} --admin {dir:shop-admin}
Stop      {dir:shop-api}/scripts/stack down --api {dir:shop-api} --web {dir:shop-web} --admin {dir:shop-admin}
Progress  {dir:shop-api}/scripts/stack list
```

The commands run through your shell (so `&&` and `npm` on Windows work), on your machine, as you. A preview runs the PR's code, so only preview PRs you'd be happy to run locally.

### Autonomy (ready room → Settings)

| Mode | What it means |
| --- | --- |
| ✋ **Raise your hand** (default) | Claude Code's `acceptEdits` mode. File edits and common dev commands (`git` except push, `npm`/`pnpm`/`yarn`, test runners, compilers…) run freely. Anything else and the agent **raises their hand**: you get a toast, and the agent's panel has Approve/Decline buttons. |
| 🤖 **Auto mode** | Claude Code's auto-mode classifier decides. Agents only raise their hand when it can't. |
| 🚀 **Full autonomy** | `bypassPermissions`. Fastest, but agents can run anything on your machine. |

None of these is a sandbox. Agents run as you, on your machine, with your `gh` credentials. Treat full autonomy accordingly.

Cloud agents run in a cloud VM rather than on your machine, but they push to GitHub as you. In ✋ mode, the one push they may make without asking is `git push origin HEAD:<their branch>`. GitHub access from a cloud session doesn't limit which branches can be pushed, so use branch protection on GitHub for anything that matters.

## Configuration

| Env var | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `4477` / `127.0.0.1` | where the office listens |
| `FOCUS_DATA_DIR` | `~/.focus` | state, agent logs, repo clones, worktrees and preview checkouts |
| `FOCUS_MODE=demo` | | same as `--demo` |
| `FOCUS_BOARD_REFRESH_MS` | `60000` | how often boards re-read issues and PRs |
| `FOCUS_BROWSER_PATH` | | Chromium/Chrome binary for agent browser testing |
| `FOCUS_USE_API_KEY=1` | | let agents use `ANTHROPIC_API_KEY` instead of your Claude login |
| `FOCUS_DEMO_SPEED` | `1` | speed up the pretend agents in demo mode |
| `FOCUS_AUTO_UPDATE=0` | | turn off auto update |
| `FOCUS_UPDATE_CHECK_MS` | `300000` | how often auto update checks for new commits |

### Auto update

`npm run dev` and `npm start` keep the office on the latest code. Every few minutes the office fetches the branch your Focus checkout tracks (usually `origin/main`). When new commits land there, it waits until no agent is busy, fast-forwards, runs `npm install` if dependencies changed and rebuilds the client (`npm start` only). Then it restarts, and open browser tabs reload on their own. It skips the update when the checkout has local commits or uncommitted changes, and it stays off in demo mode.

The data dir is deliberately outside this repo. Otherwise agents working in a worktree under it would pick up this project's `CLAUDE.md`.

## Architecture

```
shared/types.ts           types shared by server and client (Project, Agent, Board, IssueDraft, events…)
shared/crew.ts            how the crew look (uniforms, species), and the permanent crew per room (the ops officer, the QA officer), derived from the project id
shared/qa.ts              QA decisions shared by server and board (badges, stale verdicts)
server/
  supervise.ts            runs index.ts and restarts it after an auto update
  updater.ts              auto update: fetch, fast-forward, install/build, restart
  index.ts                express + WebSocket (/ws) + Vite middleware (dev) or dist/ (prod)
  office.ts               projects/rooms, Kanban boards (polling GitHub), auto-assign, settings
  store.ts                ~/.focus/state.json + per-agent terminal logs (jsonl)
  routes.ts               REST API used by the panels
  hub.ts                  broadcasts ServerEvents to every browser tab
  previews.ts             ▶ Preview: check a PR out, run the project's preview commands, find its links, tear it down
  github/                 GitHub as an Effect service: gh CLI layer (live), in-memory layer (demo), Promise adapter
  agents/
    manager.ts            hire → queue → worktree → run → commit nudge → push → PR; messages, approvals
    claudeRunner.ts       Claude Agent SDK query() in streaming-input mode, permission callback; cloud agents via --cloud
    cloud.ts              what happens after a cloud agent's session (push nudge, carrying on in a new session, falling back to local when the CLI refuses --cloud)
    render.ts             SDK messages → Claude-Code-style terminal lines + "what am I doing" text + screenshots in tool results
    browserTool.ts        in-process MCP server driving headless Chromium, streams screenshots
    workspace.ts          git mirrors + worktrees (agents', the per-repo preview checkout, the planner's read-only checkouts)
    planner.ts            the officer at each room's New issue stand: issue drafts, their prompt and schema
    briefing.ts           briefings in the observation lounge: turns, the brief, wrap-up into a stand draft
    claudeCrew.ts         the officer's read-only Claude Code sessions (Read/Glob/Grep, web search/fetch in briefings, update_brief, structured output)
    qa.ts                 the QA officer: instructions, the report's schema and parsing, the PR comment
    demoRunner.ts         scripted pretend agents (and a pretend planner, briefing officer and QA officer) for demo mode
client/src/
  main.ts                 renderer (toon shading + outline pass), loop, interaction, UI wiring
  world/                  ship layout, holodecks, stations, characters, laptop screens, Kanban display
    scenery.ts            stencil "holo walls" that show a landscape built around a room
    themes.ts             the landscapes (beach, forest, desert, moon, city, library)
    lounge.ts             the observation lounge: briefing table, officer, the brief on the wall screen
  ui/                     HUD and panels (agent terminal, board, ready room console, teleport, QA station, briefing)
```

The client mirrors server state over the WebSocket. Every action is a small REST call. Laptop screens and Kanban displays are canvases drawn into textures, and only redrawn when something changes. Screens near you redraw faster.

## Scripts

| | |
| --- | --- |
| `npm run demo` | demo mode with hot reload |
| `npm run dev` | live mode with hot reload |
| `npm run build` | build the client into `dist/` |
| `npm start` | serve `dist/` in live mode |
| `npm run typecheck` | `tsc` over server, client and shared code |
| `npm test` | unit tests (vitest) for the pure decision code: QA verdicts, badges, prompts |
