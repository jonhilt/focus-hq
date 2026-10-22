import { focus } from '../../plugin-api/browser';
import type { Attention } from '../../plugin-api/shared';
import { waiting } from './inbox';
import { needingYou } from './lanes';

// What waits on the captain as this browser has Focus (Comms, its badge, the phone's strips): the same lists as the
// inbox Focus serves (`GET /api/plugins/chief-of-staff/inbox`), worked out from the agents and boards it mirrors.

/** What's hailing the captain across the shown projects, for the badge: `needingYou` over the agents and the boards' PRs. */
export const hailing = (now = Date.now()): Attention[] => needingYou(focus.shownAgents(), focus.shownPrs(), focus.reviews, now);

/**
 * Everything waiting on the captain across the shown projects: the hails, then the leads whose turn they've read but
 * not answered, then the turns the chief of staff has words ready for or is reading (`waiting`).
 */
export const waitingNow = (now = Date.now()): Attention[] =>
  waiting(focus.shownAgents(), focus.shownPrs(), focus.reviews, focus.shown.flatMap((p) => focus.leadsIn(p.id)), now);
