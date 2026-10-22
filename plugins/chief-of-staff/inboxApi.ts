import { callPlugin, readPlugin } from '../../plugin-api/browser';
import type { MessageReply } from '../../plugin-api/shared';
import type { Decide, Inbox } from './inbox';
import { CHIEF_OF_STAFF } from './shared';

// The captain's inbox from the browser: its own routes (routes.ts, docs/ledger.md#the-captains-inbox-api).

const item = (id: string) => `/inbox/${encodeURIComponent(id)}`;

export const inbox = {
  /** What needs the captain, and what they decided lately. */
  view: (): Promise<Inbox> => readPlugin<Inbox>(CHIEF_OF_STAFF, '/inbox'),
  /** Answers an item by its id, from Focus. */
  decide: (id: string, decide: Decide): Promise<{ ok: true } | MessageReply> => callPlugin(CHIEF_OF_STAFF, `${item(id)}/decide`, { ...decide, via: 'office' }),
  /** Holds its words on an item, so they wait for the captain rather than going by themselves. */
  hold: (id: string): Promise<unknown> => callPlugin(CHIEF_OF_STAFF, `${item(id)}/hold`),
};
