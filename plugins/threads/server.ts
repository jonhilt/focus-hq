// The threads plugin: each project's loose threads, the contacts its goals' leads logged and left open and the ideas
// for next its goals closed with, kept past the goal that noticed them, and where the captain decided each ends.
// FOCUS_PLUGINS=threads, then switched on per project.
import os from 'node:os';
import { demoPace, errorMessage, type FocusPlugin, type PluginGoals, type PluginHost, type PluginParts, sleep } from '../../plugin-api/server';
import { acceptances, afterLine, closedThreads, decision, freshThreads, lastSort, lastSorts, spunOffEntry, type Thread, THREADS, type ThreadsState, toSpinOff } from './shared';
import { demoAnswer, proposalsFrom, SORT_MODEL, SORT_SCHEMA, SORT_SYSTEM, sortPrompt, sortRecord, toSort } from './sort';

/** What the threads plugin asks of Focus: starting a goal is all it does with the ship's goals, and Sort for me asks a model. */
export type ThreadsHost = Pick<PluginHost, 'state' | 'ledger' | 'record' | 'agents' | 'on' | 'demo' | 'settings' | 'readOnlySession' | 'toast'> & {
  goals: Pick<PluginGoals, 'start'>;
};

/** The project a request is for, if its threads are switched on. */
function projectOf(host: ThreadsHost, body: Record<string, unknown>): string {
  const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  if (!host.on(projectId)) throw new Error('Threads isn’t switched on for that project');
  return projectId;
}

/** The sorts under way but project `projectId`'s. */
const without = (sorting: ThreadsState['sorting'], projectId: string): ThreadsState['sorting'] =>
  Object.fromEntries(Object.entries(sorting).filter(([id]) => id !== projectId));

/** The threads plugin's parts, on what Focus lends it. */
export function threadsParts(host: ThreadsHost): PluginParts {
  // read from the ledger, which keeps every goal whole as it closed, every decision and every proposal, so there's
  // nothing of its own to save: a sort under way is only in memory, and a restart forgets it, proposing nothing
  const state = host.state(freshThreads, { saved: false });
  const read = () => {
    const events = host.ledger();
    state.set({ closed: closedThreads(events), sorts: lastSorts(events) });
  };
  const leadsIn = (projectId: string) => host.agents().filter((a) => a.projectId === projectId && a.lead);
  // the goals under way in a project, whose threads are their leads'
  const underWay = (projectId: string) => new Set(leadsIn(projectId).map((a) => a.id));

  /** What the model (or, in the demo, its stand-in) proposes of `listed`, project `projectId`'s threads to decide. */
  async function answer(projectId: string, listed: Thread[]): Promise<{ structured: unknown; model: string; costUsd?: number }> {
    if (host.demo) {
      await sleep(1500 / demoPace());
      return { structured: demoAnswer(listed, leadsIn(projectId)), model: 'demo', costUsd: 0 };
    }
    const result = await host.readOnlySession({
      cwd: os.tmpdir(),
      system: SORT_SYSTEM,
      systemAppend: '',
      prompt: sortPrompt(listed, sortRecord(host.ledger(), projectId, leadsIn(projectId), Date.now())),
      settings: host.settings(),
      signal: new AbortController().signal,
      activity: () => undefined,
      builtins: [],
      schema: SORT_SCHEMA,
      model: SORT_MODEL,
      maxTurns: 2,
      // a whole project in one answer, a few hundred proposals at most: minutes, not seconds
      timeoutMs: 10 * 60_000,
    });
    return { structured: result.structured, model: result.model ?? SORT_MODEL, ...(result.costUsd !== undefined && { costUsd: result.costUsd }) };
  }

  /** Sorts `listed`: what came back, or why nothing did, is a ledger line, which the register reads like any other. */
  async function sort(projectId: string, listed: Thread[]): Promise<void> {
    try {
      const said = await answer(projectId, listed);
      host.record(projectId, { kind: 'thread-proposals', asked: listed.length, proposals: proposalsFrom(said.structured, listed), model: said.model, ...(said.costUsd !== undefined && { costUsd: said.costUsd }) });
    } catch (err) {
      host.record(projectId, { kind: 'thread-proposals', asked: listed.length, proposals: [], model: SORT_MODEL, failed: errorMessage(err) });
      host.toast('error', `Sorting the threads failed: ${errorMessage(err)}`);
    }
  }

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
      // Sort for me: a model proposes where the project's threads to decide end, in the background; one sort at a time
      {
        method: 'post',
        path: '/sort',
        handle: ({ body }) => {
          const projectId = projectOf(host, body);
          if (state.get().sorting[projectId]) throw new Error('It’s sorting them already');
          const listed = toSort(state.get().closed[projectId], underWay(projectId));
          if (!listed.length) throw new Error('There’s nothing left to decide');
          state.set({ sorting: { ...state.get().sorting, [projectId]: { at: Date.now(), asked: listed.length } } });
          void sort(projectId, listed).finally(() => state.set({ sorting: without(state.get().sorting, projectId) }));
          return { asked: listed.length };
        },
      },
      // the captain accepts what was proposed: of one thread, or every drop (say) at once, each a decision line saying so
      {
        method: 'post',
        path: '/accept',
        handle: ({ body }) => {
          const projectId = projectOf(host, body);
          const made = acceptances(state.get().closed[projectId], underWay(projectId), body);
          if ('error' in made) throw new Error(made.error);
          for (const entry of made.entries) host.record(projectId, entry);
          return { accepted: made.entries.length };
        },
      },
    ],
    ledgerRecorded(e) {
      if (e.kind === 'goal-closed' || e.kind === 'thread-decided') state.set({ closed: afterLine(state.get().closed, e) });
      if (e.kind === 'thread-proposals') state.set({ closed: afterLine(state.get().closed, e), sorts: { ...state.get().sorts, [e.projectId]: lastSort(e) } });
    },
  };
}

const threads: FocusPlugin = { id: THREADS, start: threadsParts };

export default threads;
