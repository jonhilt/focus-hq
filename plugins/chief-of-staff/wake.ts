import type { LeadNote } from '../../plugin-api/server';
import { autoSendBackFor } from '../../plugin-api/server';

// When the chief of staff wakes a goal's lead for a note Ops left them (README.md): the core never does, since only the
// captain starts a lead's next turn there. The note goes ahead of its message, so the message only says what to do.

/** How many times QA can fail one of the lead's pull requests before it stops sending them back: then it's the captain's. */
export const LEAD_FIX_ROUNDS = 2;

/**
 * What the chief of staff wakes the lead with for `note`, in a project that sends QA's fails back (`autoSendBack`), or
 * nothing, when the note waits for the captain: a QA fail goes back to the lead a couple of rounds at most (not one on
 * a commit they've shipped past: QA's on the latest already), and a slice that's landed carries them on.
 */
export function wakeFor(note: Pick<LeadNote, 'about' | 'inTurn'>, project: { autoSendBack?: boolean }): string | undefined {
  const { about } = note;
  switch (about.kind) {
    case 'qa-verdict':
      if (about.verdict !== 'fail' || about.behind || !autoSendBackFor(project) || about.failedRounds > LEAD_FIX_ROUNDS) return undefined;
      return `Fix ${about.repo}#${about.number} and ship again (QA's verdict is just above), or tell the captain why not.`;
    case 'slice-landed':
      // mid-turn, their commits come along: a lead that stops to make the move happen leaves the goal waiting on the captain
      return note.inTurn
        ? `Slice ${about.slice} has landed: carry on where you are. Your repos move to fresh code at the start of your next turn, bringing your commits along.`
        : `Slice ${about.slice} has landed: carry on with what's next, unless it's the captain's call.`;
    case 'other':
      return undefined;
  }
}
