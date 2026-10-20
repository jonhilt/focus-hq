// The plan usage readout in the browser: a stat on the HUD wherever you are, the readout across the top of
// the engineering overview, and its gauges on main engineering's MSD.
import { type ClientPlugin, pluginState } from '../../plugin-api/client';
import { drawUsage } from './msd';
import { usageStat } from './readout';
import { USAGE, type Usage } from './shared';
import { usageView } from './view';
import './usage.css';

/** The readout as the plugin's server part last sent it: none until it has. */
const usage = (): Usage | null => pluginState<Usage>(USAGE) ?? null;

const plugin: ClientPlugin = {
  id: USAGE,
  hud: () => {
    const stat = usageStat(usage());
    return stat && { text: `◔ ${stat.text}`, ...(stat.tone !== 'ok' && { tone: stat.tone }), title: 'Your Claude plan’s usage' };
  },
  engineering: { top: (ui) => usageView(ui, usage()) },
  msd: (ctx, box) => drawUsage(ctx, box, usage()),
};

export default plugin;
