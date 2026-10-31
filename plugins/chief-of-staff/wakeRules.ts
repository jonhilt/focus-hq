import type { LeadNote } from '../../plugin-api/server';
import { autoSendBackFor } from '../../plugin-api/shared';

// When the chief of staff wakes a goal's lead for a note Ops left them (README.md): the core never does, since only the
// captain starts a lead's next turn there. The note goes ahead of its message, so the message only says what to do.

/** How many times QA can fail one of the lead's pull requests before it stops sending them back: then it's the captain's. */
export const LEAD_FIX_ROUNDS = 2;

/**
 * What the chief of staff wakes the lead with for `note`, in a project that sends QA's fails back (`autoSendBack`), or
 * nothing, when the note waits for the captain: a QA fail goes back to the lead a couple of rounds at most (not one on
 * a commit they've shipped past: QA's on the latest already; nor one a developer of Ops' is fixing), and a slice that's
 * landed carries them on.
 */
export function wakeFor(note: Pick<LeadNote, 'about' | 'inTurn'>, project: { autoSendBack?: boolean }): string | undefined {
  const { about } = note;
  switch (about.kind) {
    case 'qa-verdict':
      // one Ops sent to a developer of its own isn't the lead's to fix, unless it comes back to them
      if (about.verdict !== 'fail' || about.behind || about.fixer || !autoSendBackFor(project) || about.failedRounds > LEAD_FIX_ROUNDS) return undefined;
      return `Fix ${about.repo}#${about.number} and ship again (QA's verdict is just above), or tell the captain why not.`;
    case 'slice-landed':
      // a lead that stops after each landing leaves the goal waiting on the captain: what's agreed carries it on
      return note.inTurn
        ? `Slice ${about.slice} has landed: carry on where you are.`
        : `Slice ${about.slice} has landed: carry on with what's next if it's within what the captain has agreed; if it isn't, say what you'd do and stop for them.`;
    case 'pr-review':
      // a review on GitHub is someone's word on the work: it waits for the captain to say what to do about it
      return undefined;
    case 'restacked':
      // the lead brings their checkout along as their next turn starts, whoever starts it
      return undefined;
    case 'other':
      return undefined;
  }
}
