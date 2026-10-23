// The threads plugin: each project's loose threads, the contacts its goals' leads logged and left open, kept past the
// goal that noticed them, and where the captain decided each ends. FOCUS_PLUGINS=threads, then switched on per project.
import type { FocusPlugin, PluginGoals, PluginHost, PluginParts } from '../../plugin-api/server';
import { afterLine, closedThreads, decision, freshThreads, spunOffEntry, THREADS, toSpinOff } from './shared';

/** What the threads plugin asks of Focus: starting a goal is all it does with the ship's goals. */
export type ThreadsHost = Pick<PluginHost, 'state' | 'ledger' | 'record' | 'agents' | 'on'> & { goals: Pick<PluginGoals, 'start'> };

/** The project a request is for, if its threads are switched on. */
function projectOf(host: ThreadsHost, body: Record<string, unknown>): string {
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  if (!host.on(projectId)) throw new Error('Threads isn’t switched on for that project');
  return projectId;
}

/** The threads plugin's parts, on what Focus lends it. */
export function threadsParts(host: ThreadsHost): PluginParts {
  // read from the ledger, which keeps every goal whole as it closed and every decision, so there's nothing of its own to save
  const state = host.state(freshThreads, { saved: false });
  const read = () => state.set({ closed: closedThreads(host.ledger()) });
  // the goals under way in a project, whose threads are their leads'
  const underWay = (projectId: string) => new Set(host.agents().flatMap((a) => (a.projectId === projectId && a.lead ? [a.id] : [])));
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
          const projectId = projectOf(host, body);
          const made = decision(state.get().closed[projectId], underWay(projectId), body);
          if ('error' in made) throw new Error(made.error);
          host.record(projectId, made.entry);
          return { ok: true };
        },
      },
      // the captain spins a closed goal's thread off as a goal of its own: it starts (or waits in line for a team
      // station), and only then is the thread taken on as it, a ledger line like any decision; a goal refused writes none
      {
        method: 'post',
        path: '/spin-off',
        handle: ({ body }) => {
          const projectId = projectOf(host, body);
          const spin = toSpinOff(state.get().closed[projectId], underWay(projectId), body);
          if ('error' in spin) throw new Error(spin.error);
          const started = host.goals.start(projectId, spin.text, { from: 'a project’s threads' });
          host.record(projectId, spunOffEntry(spin.thread, spin.text, started));
          return started;
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
