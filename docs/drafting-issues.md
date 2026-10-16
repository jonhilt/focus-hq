# Drafting issues

Every holodeck has an operations officer sitting at its **Ops** station in the middle of the hall, across from QA (<kbd>E</kbd> on them or their station, or <kbd>N</kbd> anywhere on the holodeck). The officer is the same person every time; their name comes from the project.

1. Type a rough idea ("let shoppers save items for later from the cart") and press **Draft it**. You can close the panel and walk off. Their speech bubble shows what they're reading.
2. The officer reads the project's repositories and writes an issue: a title, **Context** (naming the files involved), **What to build**, **Acceptance criteria** as a checklist, **Out of scope** and any **Assumptions**. They also pick which of the project's repos it belongs in. If that repo has left the project by the time they finish, the draft goes to its first repo.
3. The draft fills the form's fields. Edit it however you like, or tell them what to change and press **Redraft**. A redraft continues their last session, so they don't read the code all over again.
4. **Pin it to the board** files it as usual. Filing it, or **Discard draft**, clears the draft.

If the idea is too big or too fuzzy for one issue, the officer says so above the draft. **To a goal** (there, or next to **Draft it**) hands it to a [goal](goals.md) instead: a new one, where a lead of its own builds it a slice at a time, or one already under way, picked beside the button.

They draft one issue at a time per project, and won't start without an idea (or, for a redraft, what to change). What starts a draft and what a finished one becomes are decided in `draftRefusal` and `readyDraft` (`server/agents/planner.ts`, tested next to it).

The officer never files, pushes or edits anything. They run as a Claude Code session with only `Read`, `Glob` and `Grep`, in `dontAsk` mode, with no settings, hooks or MCP servers loaded. They read up-to-date checkouts of the project's default branches in `~/.focus/planning/<project>/`. A draft lives in memory only, so it's lost if the office restarts. Drafting sessions don't count towards **Agents working at once**.
