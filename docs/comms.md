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

Each goal's line, in Needs you and Under way, carries the tags of the plugins switched on that have a word on goals. The `flow` plugin's says what the goal's waiting on and for how long (`WAITING ON YOU · 12 MIN`, `WAITING ON QA · 4 MIN`), outlined in its state's colour, with why and where its time has gone on hover ([where goals' time goes](../plugins/flow/README.md#live-on-the-goal-board)), and counts up each minute.
- **Goals**: a button per project with how many of its team stations are taken (and how many goals are waiting for one), opening that project's goals panel, where you start, queue and reopen goals. **◂ Comms** at the top of a goals panel brings you back.

There's nothing to mark as read. A line goes away when what it's about does: the lead is at work again after your reply, the hand is lowered, the goal is closed, the conflicts are resolved.

A lead's turn stops counting on the badge once you've read it, when you open their panel (from Comms, a toast, their briefing room or the Tricorder). It doesn't vanish: it moves to the bottom of Needs you, quieter, until you answer and they're at work again. Their next turn counts again. Which turn you last read is kept on the lead (`lead.readTurn`, set through `POST /api/agents/:id/read`), so the 3D office and your phone agree. Only the screen you're looking at reads a turn: a lead's panel left open in a window that's hidden or out of focus reads nothing until you come back to it.

## The briefing

Sit in the captain's chair on the bridge and press <kbd>E</kbd> for your briefing: the same things as Needs you, in the same order, but one at a time, so you're deciding one thing rather than reading a list across every project. **Decision 2 of 5** at the top, with **‹ Back** and **Next ›** to step through without answering.

Each one is shown large with what you need to decide it, and answered right there:

- 💬 **Waiting for your reply**: what the lead said last (the end of their turn, from their terminal, formatted as the markdown it is), what they showed on their screen that turn (since you last wrote to them), as pictures that open live, so an "A, B or C?" about options they showed can be answered here, and a box to reply in. **Send** sends it as if from their panel. Showing it reads their turn, as their panel does.
- ❓ **Pick**: why they're asking, and the options side by side with their pictures. **Pick A**… answers, with anything you add in the box under them. **See them up close** opens the station's screen.
- ✋ **Approve**: what they said as they raised their hand, and the tool it's for. **Approve** / **Decline**.
- 🏁 **Ready to close**: what done looks like, from the goal's note, and what the lead said last. **Close goal**, or **Carry on** to open their panel.
- ❗ **Stuck**, 🙋 **QA needs you** and ⚠ **Resolve conflicts**: what went wrong or the pull request, and the way to it.

Once you've answered one, whatever took its place in the list comes up next. With nothing left, it says so and how many goals are getting on without you. The briefing is `client/src/ui/briefingPanel.ts`, and what it decides (a lead's last words, what they showed this turn, which item stays in front of you) is in `briefing.ts`.

Toasts still pop up as things happen. Anything in them that needs you stays in Comms' Needs you, so a toast you missed doesn't matter; the rest is news, and isn't kept.

The Tricorder's **Needs you** strip uses the same rule, order and wording (`needsYou` and `needLine` in `shared/tricorder.ts`; the client's `attention()` in `client/src/net/attention.ts` feeds it the shown projects' agents and PRs).
