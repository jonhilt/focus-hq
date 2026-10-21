// The scorecard plugin (README.md): main engineering's scorecards of Focus's own repo, measured by `pnpm run
// scorecard` on the captain's word and on each commit Focus starts on. FOCUS_PLUGINS=scorecard.
import { errorMessage, type FocusPlugin } from '../../plugin-api/server';
import { checkoutHead, focusScorecards, ScorecardDesk } from './desk';
import { direction, formatValue } from './scorecard';
import { SCORECARD, type ScorecardService, type Scorecards } from './types';

/** How long after Focus starts it measures the commit it runs from, once it's settled in. */
const MEASURE_AFTER_START_MS = 2 * 60_000;

const scorecard: FocusPlugin = {
  id: SCORECARD,
  start(host) {
    // read again from disk as Focus starts, so never saved in state.json
    const state = host.state<Scorecards>(() => ({ status: 'idle', history: [] }), { saved: false });
    const source = focusScorecards(host.demo, host.focusDir);
    const desk = new ScorecardDesk((s) => state.set(s), source);
    state.set(desk.current());
    if (!host.demo) {
      // a scorecard for each commit Focus runs from (auto update restarts it on every merge to main)
      setTimeout(() => void checkoutHead(host.focusDir).then((head) => desk.measureIfNew(head)).catch((err: unknown) => console.error(`Scorecard after start: ${errorMessage(err)}`)), MEASURE_AFTER_START_MS).unref();
    }
    const provides: ScorecardService = {
      history: (limit) => source.history(limit),
      noise: () => source.noise(),
      direction: (m, before) => direction(m, before, source.noise()),
      formatValue,
    };
    return { provides, routes: [{ method: 'post', path: '/measure', handle: () => desk.measure() }] };
  },
};

export default scorecard;
