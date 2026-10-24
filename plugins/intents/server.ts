// The intents plugin: each project's compass, what its work is for, kept as the ledger's intent lines, and changed
// only by the user's own save. FOCUS_PLUGINS=intents, then switched on per project.
import type { FocusPlugin, PluginHost, PluginParts } from '../../plugin-api/server';
import { changeLines, compassOf, compasses, freshIntents, INTENTS } from './shared';

/** What the intents plugin asks of Focus: the ledger to read and write, and whether it's on for a project. */
export type IntentsHost = Pick<PluginHost, 'state' | 'ledger' | 'record' | 'on'>;

/** The intents plugin's parts, on what Focus lends it. */
export function intentsParts(host: IntentsHost): PluginParts {
  // read from the ledger, which keeps every intent line, so there's nothing of its own to save
  const state = host.state(freshIntents, { saved: false });
  const read = () => state.set({ compasses: compasses(host.ledger()) });
  read();
  return {
    routes: [
      // a browser asks as it starts, so it has the ledger as it is then (the demo's is written after plugins start)
      { method: 'post', path: '/read', handle: () => (read(), { ok: true }) },
      // the user changes a project's compass: each line checked before any is written, then written together
      {
        method: 'post',
        path: '/change',
        handle: ({ body }) => {
          const projectId = typeof body.projectId === 'string' ? body.projectId : '';
          if (!host.on(projectId)) throw new Error('Intents isn’t switched on for that project');
          const made = changeLines(state.get().compasses[projectId], body);
          if ('error' in made) throw new Error(made.error);
          for (const entry of made.entries) host.record(projectId, entry);
          return { written: made.entries.length };
        },
      },
    ],
    // the line's in the ledger by the time it's heard, so the project's compass is read again as the core reads it
    ledgerRecorded(e) {
      if (e.kind === 'intent' && e.goalId === undefined) state.set({ compasses: { ...state.get().compasses, [e.projectId]: compassOf(host.ledger(), e.projectId) } });
    },
  };
}

const intents: FocusPlugin = { id: INTENTS, start: intentsParts };

export default intents;
