# Comms

Press <kbd>C</kbd> anywhere on the ship (or **Comms** on the pause screen) to see what's going on across every project without walking the corridors. The **COMMS** badge at the top right of the HUD counts whatever is waiting on you, and lights up while anything is.

It's an inbox: the queue of what needs you on the left, and the one you've picked on the right, large, with what you need to decide it and the buttons that answer it. The captain's chair on the bridge opens it too (sit, then <kbd>E</kbd>).

## The queue

On the left:

- **Needs you**: everything waiting on you, on every project, most urgent first (a raised hand, then an agent that's stuck, a question, a lead waiting for your reply, a goal ready to close, then pull requests; oldest first within each). Each line says what's needed, then the project (in its colour) and the goal, then who: the lead and their station, or the pull request. Click one to see it on the right. Leads whose turn you've read but not answered come last, quieter: they still need you, but aren't counted on the badge. The queue keeps its order while it's open, so nothing moves under the pointer; what's new goes on the end.
- **Under way**: a line per goal that's getting on without you, with **Talk** and **Beam there** (to the lead's seat in their briefing room). Hidden when there are none.
- **Goals**: a button per project with how many of its team stations are taken (and how many goals are waiting for one), opening that project's goals panel, where you start, queue and reopen goals. **◂ Comms** at the top of a goals panel brings you back.

Each goal's line carries the tags of the plugins switched on that have a word on goals. The `flow` plugin's says what the goal's waiting on and for how long (`WAITING ON YOU · 12 MIN`, `WAITING ON QA · 4 MIN`), outlined in its state's colour, with why and where its time has gone on hover ([where goals' time goes](../plugins/flow/README.md#live-on-the-goal-board)), and counts up each minute. A long wait is shown, never sounded: nothing in the queue turns red because time passed.

## The one you've picked

On the right: where it's from (project › goal › who), what's needed, what to read to decide it, the answers, and under them what each answer leads to.

- 💬 **Waiting for your reply**: what the lead said last (the end of their turn, from their terminal, formatted as the markdown it is), what they showed on their screen that turn (since you last wrote to them), as pictures that open live, so an "A, B or C?" about options they showed can be answered here, and a box to reply in. **Send** sends it as if from their panel. Picking it reads their turn, as their panel does.
- ❓ **Pick**: why they're asking, and the options side by side with their pictures. **Pick A**… answers, with anything you add in the box under them. **See them up close** opens the station's screen.
- ✋ **Approve**: what they said as they raised their hand, and the tool it's for. **Approve** / **Decline**.
- 🏁 **Ready to close**: what done looks like, from the goal's note, and what the lead said last. **Close goal**, or **Carry on** to open their panel.
- ❗ **Stuck**: what they said last; **Open their panel** shows what went wrong.
- 🙋 **QA needs you** and ⚠ **Resolve conflicts**: the pull request. **Pull requests** opens the board's, **GitHub ↗** the PR.

Answered, it leaves the queue and whatever took its place is picked. **Later ›** moves on to the next and leaves it in the queue: nothing else waits on it. With nothing left, it says so and how many goals are getting on without you.

There's nothing to mark as read. A line goes away when what it's about does: the lead is at work again after your reply, the hand is lowered, the goal is closed, the conflicts are resolved.

A lead's turn stops counting on the badge once you've read it, when you pick it here or open their panel (from a toast, their briefing room or the Tricorder). It doesn't vanish: it moves to the end of the queue the next time Comms opens, quieter, until you answer and they're at work again. Their next turn counts again. Which turn you last read is kept on the lead (`lead.readTurn`, set through `POST /api/agents/:id/read`), so the 3D office and your phone agree. Only the screen you're looking at reads a turn: a lead's panel left open in a window that's hidden or out of focus reads nothing until you come back to it.

Comms is `client/src/ui/commsPanel.ts` (the inbox and its queue) and `needCard.ts` (what needs you, and the one picked, large); what they decide (a lead's last words, what they showed this turn, which item stays picked, the queue's order) is in `briefing.ts`.

Toasts still pop up as things happen. Anything in them that needs you stays in Comms' queue, so a toast you missed doesn't matter; the rest is news, and isn't kept.

The Tricorder's **Needs you** strip uses the same rule, order and wording (`needsYou` and `needLine` in `shared/tricorder.ts`; the client's `attention()` in `client/src/net/attention.ts` feeds it the shown projects' agents and PRs).
