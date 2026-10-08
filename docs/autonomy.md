# Autonomy (ready room → Settings)

| Mode | What it means |
| --- | --- |
| **Raise your hand** (default) | Claude Code's `acceptEdits` mode. File edits and common dev commands (`git` except push, `npm`/`pnpm`/`yarn`, test runners, compilers…) run freely. Anything else and the agent **raises their hand**: you get a toast, and the agent's panel has Approve/Decline buttons. |
| **Auto mode** | Claude Code's auto-mode classifier decides. Agents only raise their hand when it can't. |
| **Full autonomy** | `bypassPermissions`. Fastest, but agents can run anything on your machine. |

None of these is a sandbox. Agents run as you, on your machine, with your `gh` credentials. Treat full autonomy accordingly.

Cloud agents run in a cloud VM rather than on your machine, but they push to GitHub as you. In Raise your hand mode, the one push they may make without asking is `git push origin HEAD:<their branch>`. GitHub access from a cloud session doesn't limit which branches can be pushed, so use branch protection on GitHub for anything that matters.
