# Cloud agents

An agent can work in a [Claude Code cloud session](https://code.claude.com/docs/en/claude-code-on-the-web) instead of on your machine, from the start or moved there partway through. They still get a station, and Ops still opens the PR and hands it to QA.

- **How it runs:** through the Agent SDK's bundled CLI with `--cloud`, which starts the cloud session and relays it in the same message stream as a local agent, so their terminal is live as usual.
- **When Claude Code won't start one:** the CLI starts a new cloud session without a terminal only while Anthropic has its headless cloud client switched on for your account, a server-side rollout with no flag or SDK option to request it. Otherwise it refuses ("--cloud requires an interactive terminal"), and the agent waits for you to start the session (see **Starting the session** below), or can be kept local instead.
- **Their branch:** the cloud session clones the agent's branch from GitHub, so Ops publishes it first, and the agent is told to push to that branch and only that one. When the session ends, Ops fetches the branch and opens the PR.
- **Screenshots:** Ops' browser tool runs on your machine, so cloud agents test in the cloud machine's own browser instead.
- **Follow-ups** reattach to the same cloud session. If that fails, a new cloud session picks the work up from the branch; if Claude Code refuses to start that one, Ops fetches the branch first, so nothing the cloud session pushed is lost, and the agent carries on locally.
- The QA officer always works locally: QA needs Ops' browser for its screenshots. So do goals' leads, and agents resolving merge conflicts.
- **Smoke test:** to check cloud sessions work on your account, assign a cloud agent to a small docs-only issue and confirm that a PR opens from its `focus/…` branch.

You need a claude.ai login (not `FOCUS_USE_API_KEY`) and GitHub connected for cloud sessions: install the [Claude GitHub App](https://github.com/apps/claude) on the repo, or run `/web-setup` in Claude Code. Without the app, the CLI uploads the worktree instead of cloning. On Team and Enterprise plans, an admin has to allow cloud sessions. Cloud agents count towards **Agents working at once**: they share your plan's limits. The cloud session works in your [cloud environment](https://code.claude.com/docs/en/cloud-environments) (network access, setup script), not with your local tools. The headless `--cloud` mode Ops drives isn't documented by Anthropic yet, so a Claude Code update can change how it behaves.

## Starting the session

Joining a cloud session that already exists works without a terminal on every account; only starting a new one needs one. So when Ops can't start an agent's session, you do, and Ops joins it:

- **▶ Start in a terminal** opens a terminal on this machine, in the agent's worktree, running `claude --cloud`; Ops spots the session's id as Claude Code shows it and joins. If Claude Code asks you something first (whether to trust the folder, say), answer it there. Set `FOCUS_TERMINAL` (e.g. `kitty -e`) to use your own terminal, and the script's path goes after it. The scripts and recordings are in `~/.focus/cloud-terminals/`.
- **…or paste a claude.ai/code session link**: start a session yourself (on claude.ai/code, or with `claude --cloud` in any terminal) and paste its link or id. Windows terminals aren't recorded, so there you paste the link once the terminal shows it.
- If Claude Code won't join it from Focus at all (newer versions refuse `--cloud <session_id>` with `--output-format stream-json`, which the Agent SDK always passes), the agent carries on here as a local agent instead. From then on, until Focus restarts, a cloud agent Claude Code won't start a session for carries on here too, rather than waiting for one you'd start.

## Moving an agent to the cloud

Moving a local developer to the cloud moves the work, not the conversation: everything in their worktree is committed and pushed to their branch, and the new cloud session reads the issue and `git log` to catch up. Claude Code's own `/teleport` can move a conversation to the cloud, but only from an interactive terminal, behind its own rollout, and only for a session connected to Remote Control, so Ops moves the work through the branch instead.
