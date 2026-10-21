// The captain's log: every journal Ops keeps and the ledger on one timeline, served to its panel
// (J). FOCUS_PLUGINS=captains-log, for the whole ship.
import type { FocusPlugin } from '../../plugin-api/server';
import { captainsLog, logSources } from './log';
import { CAPTAINS_LOG, logSince } from './shared';

const captainsLogPlugin: FocusPlugin = {
  id: CAPTAINS_LOG,
  start(host) {
    return {
      routes: [
        // the log since `since` (the last day by default, a week at most)
        {
          method: 'post',
          path: '/log',
          handle: ({ body }) => {
            const since = logSince(Date.now(), Number(body.since));
            return captainsLog(logSources({ journals: host.journals(since), agents: host.agents(), projects: host.projects(), ledger: host.ledger() }), since);
          },
        },
      ],
    };
  },
};

export default captainsLogPlugin;
