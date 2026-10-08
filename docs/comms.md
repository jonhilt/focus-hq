# Comms

Press <kbd>C</kbd> anywhere on the ship (or **Comms** on the pause screen) to see what's going on across every project without walking the corridors. The **COMMS** badge at the top right of the HUD counts whatever is waiting on you, and lights up while anything is.

Comms has three parts:

- **Hailing you**: everything waiting on you, on every project:
  - a goal's lead who has finished a turn and is waiting for your reply, quoting what they last said;
  - a lead who thinks their goal is ready to wrap up;
  - an agent with a raised hand;
  - an agent that hit a problem;
  - a pull request QA gave up on;
  - a pull request with conflicts nobody is resolving.

  Each hail lets you answer it there and then: a reply box straight into the agent's session, **Approve**/**Decline**, or **Close goal**. **Beam there** teleports you to the agent's seat (a lead's briefing room), and **Open** opens their panel.
- **Your turn · read**: leads whose turn you've read but not answered, quieter and not counted on the badge.
- **Under way**: one line per goal that's getting on without you, with **Talk** and **Beam there**.
- **Goals**: a button per project with how many of its team stations are taken (and how many goals are waiting for one), opening that project's goals panel, where you start, queue and reopen goals.

There's nothing to mark as read. A hail goes away when what it's about does: the lead is at work again after your reply, the hand is lowered, the goal is closed, the conflicts are resolved.

A lead's turn stops hailing once you've read it: when you open their panel (from Comms, a toast, their briefing room or the Tricorder), or press **Later** on it. It doesn't vanish: it moves to **Your turn · read**, with what they said and a reply box, until you answer and they're at work again. Their next turn hails again. Which turn you last read is kept on the lead (`lead.readTurn`, set through `POST /api/agents/:id/read`), so the 3D office and your phone agree. Only the screen you're looking at reads a turn: a lead's panel left open in a window that's hidden or out of focus reads nothing until you come back to it.

Toasts still pop up as things happen. Anything in them that needs you stays in Comms, so a toast you missed doesn't matter.

The Tricorder's **Needs you** strip uses the same rule (`needsYou` in `shared/tricorder.ts`; the client's `attention()` in `client/src/net/attention.ts` feeds it the shown projects' agents and PRs).
