# Comms

Press <kbd>C</kbd> anywhere on the ship (or **Comms** on the pause screen) to see what's going on across every project without walking the corridors. The **COMMS** badge at the top right of the HUD counts whatever is waiting on you, and lights up while anything is.

Comms has these parts:

- **Needs you**: everything waiting on you, on every project, most urgent first (a raised hand, then an agent that's stuck, a question, a lead waiting for your reply, a goal ready to close, then pull requests; oldest first within each), a line each: what's needed in bold, who and where under it, and the buttons that answer it on the right.
  - 💬 **Waiting for your reply**: a goal's lead has finished a turn. **Reply** opens their panel, where the conversation is.
  - ❓ **Pick**: a lead asked you something on their station's screen. **Pick one** opens it.
  - ✋ **Approve**: an agent with a raised hand. **Approve** / **Decline** right there.
  - ❗ **Stuck**: an agent that hit a problem. **Open** opens their panel.
  - 🏁 **Ready to close**: a lead thinks their goal is done. **Close goal**, or **Carry on** to open their panel.
  - 🙋 **QA needs you** and ⚠ **Resolve conflicts**: a pull request QA gave up on, or one with conflicts nobody is resolving. **Pull requests** opens the board's, **GitHub ↗** the PR.

  Leads whose turn you've read but not answered come last, quieter (**Waiting for your reply · read**): they still need you, but aren't counted on the badge. Most lines also have **Beam there**, which teleports you to the agent's seat (a lead's briefing room). There's no chat here: what agents said, and your replies, are in their panel.
- **Under way**: one line per goal that's getting on without you, with **Talk** and **Beam there**. Hidden when there are none.
- **Goals**: a button per project with how many of its team stations are taken (and how many goals are waiting for one), opening that project's goals panel, where you start, queue and reopen goals. **◂ Comms** at the top of a goals panel brings you back.

There's nothing to mark as read. A line goes away when what it's about does: the lead is at work again after your reply, the hand is lowered, the goal is closed, the conflicts are resolved.

A lead's turn stops counting on the badge once you've read it, when you open their panel (from Comms, a toast, their briefing room or the Tricorder). It doesn't vanish: it moves to the bottom of Needs you, quieter, until you answer and they're at work again. Their next turn counts again. Which turn you last read is kept on the lead (`lead.readTurn`, set through `POST /api/agents/:id/read`), so the 3D office and your phone agree. Only the screen you're looking at reads a turn: a lead's panel left open in a window that's hidden or out of focus reads nothing until you come back to it.

Toasts still pop up as things happen. Anything in them that needs you stays in Comms' Needs you, so a toast you missed doesn't matter; the rest is news, and isn't kept.

The Tricorder's **Needs you** strip uses the same rule, order and wording (`needsYou` and `needLine` in `shared/tricorder.ts`; the client's `attention()` in `client/src/net/attention.ts` feeds it the shown projects' agents and PRs).
