// The scorecard plugin (README.md): main engineering's scorecards of the office's own repo, measured by `pnpm run
// scorecard` on the captain's word and on each commit the office starts on. FOCUS_PLUGINS=scorecard.
import { config } from '../../server/config';
import type { FocusPlugin } from '../../server/plugins/contract';
import { errorMessage } from '../../server/util';
import { checkoutHead, officeScorecards, ScorecardDesk } from './desk';
import { SCORECARD, type ScorecardService, type Scorecards } from './types';

/** How long after the office starts it measures the commit it runs from, once it's settled in. */
const MEASURE_AFTER_START_MS = 2 * 60_000;

const scorecard: FocusPlugin = {
  id: SCORECARD,
  start(host) {
    // read again from disk as the office starts, so never saved in state.json
    const state = host.state<Scorecards>(() => ({ status: 'idle', history: [] }), { saved: false });
    const source = officeScorecards(host.demo);
    const desk = new ScorecardDesk((s) => state.set(s), source);
    state.set(desk.current());
    if (!host.demo) {
      // a scorecard for each commit the office runs from (auto update restarts it on every merge to main)
      setTimeout(() => void checkoutHead(config.root).then((head) => desk.measureIfNew(head)).catch((err: unknown) => console.error(`Scorecard after start: ${errorMessage(err)}`)), MEASURE_AFTER_START_MS).unref();
    }
    const provides: ScorecardService = { history: (limit) => source.history(limit), noise: () => source.noise() };
    return { provides, routes: [{ method: 'post', path: '/measure', handle: () => desk.measure() }] };
  },
};

export default scorecard;
