// The plan usage plugin: main engineering's readout of your Claude plan's usage, read from Claude Code's
// structured /usage every few minutes, with how Focus's sessions sign in. Its browser part puts it on the HUD,
// across the top of the engineering overview, and on the MSD. FOCUS_PLUGINS=usage, for the whole ship.
import type { FocusPlugin } from '../../plugin-api/server';
import { demoPlanUsage } from './demo';
import { USAGE, type Usage } from './shared';
import { readPlanUsage, usageOf, UsageWatch } from './watch';

const usage: FocusPlugin = {
  id: USAGE,
  start(host) {
    // read again as Focus starts, so never saved
    const state = host.state<Usage>(() => usageOf(null, undefined, host.signIn()), { saved: false });
    // the demo's plan is made up; a live Focus asks Claude Code from the plugin's own folder
    const watch = new UsageWatch(state, () => host.signIn(), host.demo ? () => demoPlanUsage() : () => readPlanUsage(host.dataDir()));
    watch.start();
    return { signInChanged: () => watch.changed() };
  },
};

export default usage;
