// The briefings plugin (README.md): the lead's explain tool, an animated explainer of a concept on their station's
// screen in the office's LCARS player. Its browser part narrates a briefing up close.
// FOCUS_PLUGINS=briefings, and switched on in each project's settings.
import type { FocusPlugin } from '../../plugin-api/server';
import { explainTool } from './explainTool';
import { BRIEFINGS } from './shared';
import { officeSources } from './sources';

const briefings: FocusPlugin = {
  id: BRIEFINGS,
  start: (host) => ({ leadTools: [explainTool(officeSources(host))] }),
};

export default briefings;
