// The threads plugin: each project's loose threads, the contacts its goals' leads logged and left open, kept past the
// goal that noticed them, and where the captain decided each ends. FOCUS_PLUGINS=threads, then switched on per project.
import type { FocusPlugin, PluginHost, PluginParts } from '../../plugin-api/server';
import { afterLine, closedThreads, decision, freshThreads, THREADS } from './shared';

/** What the threads plugin asks of Focus. */
export type ThreadsHost = Pick<PluginHost, 'state' | 'ledger' | 'record' | 'agents' | 'on'>;

/** The threads plugin's parts, on what Focus lends it. */
export function threadsParts(host: ThreadsHost): PluginParts {
  // read from the ledger, which keeps every goal whole as it closed and every decision, so there's nothing of its own to save
  const state = host.state(freshThreads, { saved: false });
  const read = () => state.set({ closed: closedThreads(host.ledger()) });
  read();
  return {
    routes: [
      // a browser asks as it starts, so it has the ledger as it is then (the demo's is written after plugins start)
      { method: 'post', path: '/read', handle: () => (read(), { ok: true }) },
      // the captain decides where a closed goal's thread ends: a ledger line, which the register then reads like any other
      {
        method: 'post',
        path: '/decide',
        handle: ({ body }) => {
          const projectId = typeof body.projectId === 'string' ? body.projectId : '';
          if (!host.on(projectId)) throw new Error('Threads isn’t switched on for that project');
          const underWay = new Set(host.agents().flatMap((a) => (a.projectId === projectId && a.lead ? [a.id] : [])));
          const made = decision(state.get().closed[projectId], underWay, body);
          if ('error' in made) throw new Error(made.error);
          host.record(projectId, made.entry);
          return { ok: true };
        },
      },
    ],
    ledgerRecorded(e) {
      if (e.kind === 'goal-closed' || e.kind === 'thread-decided') state.set({ closed: afterLine(state.get().closed, e) });
    },
  };
}

const threads: FocusPlugin = { id: THREADS, start: threadsParts };

export default threads;
