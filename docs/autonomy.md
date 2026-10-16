# Autonomy (ready room → Settings)

| Mode | What it means |
| --- | --- |
| **Raise your hand** (default) | Claude Code's `acceptEdits` mode. File edits and common dev commands (`git` except push, `npm`/`pnpm`/`yarn`, test runners, compilers…) run freely. Anything else and the agent **raises their hand**: you get a toast, and the agent's panel has Approve/Decline buttons. |
| **Auto mode** | Claude Code's auto-mode classifier decides. Agents only raise their hand when it can't. |
| **Full autonomy** | `bypassPermissions`. Fastest, but agents can run anything on your machine. |

The office setting is the default: it applies to agents started from then on, and to every agent you haven't given a mode of their own.

## One agent's mode

Each agent's panel has an **Autonomy** picker in its header, beside their effort and context, showing the mode they work in. Pick another to change it for that agent alone, whether they're working, idle or finished: the office setting and every other agent stay as they are. Their terminal gets a line saying so (`✻ The captain set Ensign Okafor's autonomy to Full autonomy`).

- A session running on this machine switches at once, without restarting (Claude Code's `setPermissionMode`): an agent moved from Raise your hand to Full autonomy runs their next command without raising their hand, and one moved back raises it again. A hand already up stays up until you answer it.
- A cloud session's permissions are set as its turn starts, so the change applies from their next turn, and the line says so.
- The choice stays on the agent (`autonomy` on their record): their later turns and resumes start in it. Changing the office setting afterwards doesn't touch them.

Every tool call a session asks about goes through one callback (`toolPermission` in `server/agents/claudeRunner.ts`, tested next to it). It reads the agent's mode afresh on each call, so a switch applies to the very next one. It lets through what that mode allows without asking (`allowedWithoutAsking`), and anything from an agent of a workflow you approved, still running: it gives the workflow's progress up to 2 s to name that agent. Anything else raises the hand. What the hand says comes from `permissionAsk`: for a workflow, its name and what approving it means; otherwise Claude Code's own title for the call, else the tool and the command, file, URL or pattern it's on. Decline it and the agent is told to find another approach, or to explain in its summary why the action is needed.

Local sessions are always started able to switch: bypassing permissions is allowed from the start (Claude Code needs that up front) and they carry Raise your hand's command rules whatever mode they start in. In Auto mode those rules only spare the classifier a few calls.

None of these is a sandbox. Agents run as you, on your machine, with your `gh` credentials. Treat full autonomy accordingly.

Cloud agents run in a cloud VM rather than on your machine, but they push to GitHub as you. In Raise your hand mode, the one push they may make without asking is `git push origin HEAD:<their branch>`. GitHub access from a cloud session doesn't limit which branches can be pushed, so use branch protection on GitHub for anything that matters.
