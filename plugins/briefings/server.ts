// The briefings plugin (README.md): the lead's explain tool, an animated explainer of a concept on their station's
// screen in the office's LCARS player, written by the lead or by the office's writer from their brief, on the model the
// captain set (`/writer`). Its browser part narrates a briefing up close, and has the setting on the engineering panel.
// FOCUS_PLUGINS=briefings, and switched on in each project's settings.
import type { FocusPlugin } from '../../plugin-api/server';
import { explainTool } from './explainTool';
import { BRIEFINGS, freshBriefings, writerPatch } from './shared';
import { officeSources } from './sources';
import { officeWriter } from './writer';

const briefings: FocusPlugin = {
  id: BRIEFINGS,
  start: (host) => {
    const state = host.state(freshBriefings);
    const sources = officeSources(host);
    const setWriter = (body: unknown) => {
      const patch = writerPatch(body);
      if (typeof patch === 'string') throw new Error(patch);
      state.set({ writer: { ...state.get().writer, ...patch } });
      return state.get();
    };
    return {
      leadTools: [explainTool(sources, officeWriter(host, state, sources))],
      routes: [{ method: 'post', path: '/writer', handle: ({ body }) => setWriter(body) }],
    };
  },
};

export default briefings;
