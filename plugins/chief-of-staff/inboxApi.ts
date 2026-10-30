import { callPlugin, pluginStateNow, readPlugin } from '../../plugin-api/browser';
import type { FeedbackSignal, MessageReply } from '../../plugin-api/shared';
import { type FeedbackPress, pressedOf } from './feedbackRules';
import type { Decide, Inbox } from './inbox';
import type { LandedAnswer } from './landed';
import { CHIEF_OF_STAFF } from './shared';

// The captain's inbox from the browser: its own routes (routes.ts, docs/ledger.md#the-captains-inbox-api).

const item = (id: string) => `/inbox/${encodeURIComponent(id)}`;

export const inbox = {
  /** What needs the captain, and what they decided lately. */
  view: (): Promise<Inbox> => readPlugin<Inbox>(CHIEF_OF_STAFF, '/inbox'),
  /** Answers an item by its id, from Focus. */
  decide: (id: string, decide: Decide): Promise<{ ok: true } | MessageReply> => callPlugin(CHIEF_OF_STAFF, `${item(id)}/decide`, { ...decide, via: 'office' }),
  /** Answers a slice that landed in Show: Got it, Redirect or Revert. */
  decideLanded: (id: string, answer: LandedAnswer): Promise<{ ok: true }> => callPlugin(CHIEF_OF_STAFF, `/landed/${encodeURIComponent(id)}/decide`, { ...answer, via: 'office' }),
  /** Holds its words on an item, so they wait for the captain rather than going by themselves. */
  hold: (id: string): Promise<unknown> => callPlugin(CHIEF_OF_STAFF, `${item(id)}/hold`),
};

/** The user's one-tap word on a lead's turn (feedbackRules.ts): pressing a signal (or, pressed, taking it back), and what's pressed now. */
export const feedback = {
  press: (press: FeedbackPress): Promise<{ pressed: FeedbackSignal[] }> => callPlugin(CHIEF_OF_STAFF, '/feedback', press),
  pressed: (): Record<string, FeedbackSignal[]> => pressedOf(pluginStateNow(CHIEF_OF_STAFF)),
};
