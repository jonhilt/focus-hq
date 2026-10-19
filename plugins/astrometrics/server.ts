// The astrometrics plugin (README.md): the office's state machines, each laid out once as the office starts, and
// where every run of them is now, kept up to date as their journals step, for the holodeck's screen to draw.
// FOCUS_PLUGINS=astrometrics.
import { errorMessage, type FocusPlugin } from '../../plugin-api/server';
import { layOut } from './layout';
import { ASTROMETRICS, type Astrometrics, freshAstrometrics } from './shared';

/** How long after a journal steps the runs are read again: a turn's end steps several at once. */
const SETTLE_MS = 200;

const astrometrics: FocusPlugin = {
  id: ASTROMETRICS,
  start(host) {
    // read again as the office starts, from the machines' code and their journals
    const state = host.state<Astrometrics>(freshAstrometrics, { saved: false });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      timer = undefined;
      state.set({ runs: [...host.machines().runs] });
    };
    const soon = () => (timer ??= setTimeout(refresh, SETTLE_MS));
    void Promise.all(host.machines().graphs.map(layOut)).then(
      (layouts) => state.set({ layouts, runs: [...host.machines().runs] }),
      (err: unknown) => state.set({ error: `The machines couldn’t be laid out: ${errorMessage(err)}` }),
    );
    return {
      // a run's path through one of the machines, from its journal, for the close-up to draw its trail
      routes: [{ method: 'post', path: '/path', handle: ({ body }) => host.machinePath(String(body.machine ?? ''), String(body.key ?? '')) }],
      machineStepped: soon,
      // agents come and go, and reviews leave the boards, without a journal stepping
      boardRefreshed: soon,
    };
  },
};

export default astrometrics;
