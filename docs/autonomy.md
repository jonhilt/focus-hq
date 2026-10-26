# Autonomy (ready room → Settings)

| Mode | What it means |
| --- | --- |
| **Raise your hand** (default) | Claude Code's `acceptEdits` mode. File edits and common dev commands run freely; anything else and the agent **raises their hand** for you to approve or decline. |
| **Auto mode** | Claude Code's auto-mode classifier decides. Agents only raise their hand when it can't. |
| **Full autonomy** | `bypassPermissions`. Fastest, but agents can run anything on your machine. |

The ship-wide setting is the default: it applies to agents started from then on, and to every agent you haven't given a mode of their own.

## One agent's mode

An agent can be given a mode of their own, whether they're working, idle or finished: the ship-wide setting and every other agent stay as they are. The choice stays on the agent: their later turns and resumes start in it, and changing the ship-wide setting afterwards doesn't touch them.

- A session running on this machine switches at once, without restarting: the mode is read afresh on each tool call, so a switch applies to the very next one (`toolPermission`, tested next to it in `server/agents/claudeRunner.test.ts`). A hand already up stays up until you answer it.
- A cloud session's permissions are set as its turn starts, so the change applies from their next turn.

Local sessions are always started able to switch: bypassing permissions is allowed from the start (Claude Code needs that up front) and they carry Raise your hand's command rules whatever mode they start in. In Auto mode those rules only spare the classifier a few calls.

None of these is a sandbox. Agents run as you, on your machine, with your `gh` credentials. Treat full autonomy accordingly.

Raise your hand stops an agent's honest mistakes, not one steered by what it reads. Its commands that never ask include `curl`, `node` and `python3`, and Focus answers any request to its own address that no other site's page sent (`server/hostGuardRules.ts`), so an agent told to by an issue's or a comment's text can give itself full autonomy without raising its hand. Treat an agent working on text from someone you don't trust as having full autonomy.

Cloud agents run in a cloud VM rather than on your machine, but they push to GitHub as you. In Raise your hand mode, the one push they may make without asking is `git push origin HEAD:<their branch>`. GitHub access from a cloud session doesn't limit which branches can be pushed, so use branch protection on GitHub for anything that matters.
