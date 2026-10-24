import { describe, expect, it } from 'vitest';
import type { GoalRecord, LedgerEntry, LedgerEvent, PluginParts, PluginState, ReadOnlyResult } from '../../plugin-api/server';
import { checkAtOnce, checkRestart, type Later, type Running, type Subject } from '../../plugin-api/testing';
import { type ThreadsHost, threadsParts } from './server';
import type { ThreadsState } from './shared';

// The threads plugin under Focus's two rules (docs/invariants.md): a restart is atomic, and two decisions at once end
// as one after the other would. What it keeps across a restart is the ledger alone: the register it shows, what was
// proposed of it and what was decided, is read back from it. It's described here (what it can do, what must survive),
// not told what to expect.
//
// Its stand-ins: the host's ledger is an array, written and heard (`ledgerRecorded`) at once, as Focus's is; the goals
// it starts are a list, kept as they start (starting a goal is Focus's, described with the manager's); and Sort for
// me's model answers through `later`, so a restart can fall while it's out. Nothing else waits on the world outside.
//
// Breaks seen caught: the decision put in the register without its ledger line fails the restart check and both
// promises below; a spin-off that starts its goal without writing the line fails the reach test and the promise that
// a thread is spun off once (not the restart check: nothing is awaited between the goal starting and its line, so no
// restart falls between them); proposals put in the register without their ledger line fail the reach test and the
// promise that a restart keeps every proposal (not the restart check: proposals lost look like a sort never asked
// for). Two decisions at once can't interleave (a decision is checked and written in one step, with nothing awaited
// between). Two sorts at once end as one after the other would, each writing its line, so a second sort isn't
// refused for the rules' sake: only so the model isn't asked twice over.

const goal = (id: string, open: string[], closedAt: number, next: string[] = []): GoalRecord => ({
  id, title: `Goal ${id}`, slices: 1, prs: [], leadName: 'Lt. Reyes', openedAt: 0, closedAt,
  contacts: open.map((c, i) => ({ id: c, text: `thread ${id} ${c}`, slice: 1, at: i })),
  ...(next.length && { note: { done: '', learned: [], next } }),
});

const THREADS_SEEN = [['g1', 'c1'], ['g1', 'c2'], ['g2', 'c1']] as const;
const DECISIONS = [['next', ''], ['parked', 'until the first login'], ['dropped', 'nobody needs it'], ['resolved', '#12'], ['open', '']] as const;

/** What the model proposes, whatever it's asked: the first thread listed dropped, the second resolved. */
const ANSWER: ReadOnlyResult = { text: '', structured: { proposals: [{ id: 't1', as: 'dropped', why: 'stale' }, { id: 't2', as: 'resolved', why: 'by #12' }] }, model: 'sonnet', costUsd: 0.01 };

/** What must survive: every decision and proposal line in the ledger, the register as the plugin shows it, and the goals it started. */
interface Kept {
  lines: string[];
  register: string[];
  goals: string[];
}

const lineOf = (e: LedgerEvent): string[] => {
  if (e.kind === 'thread-proposals') return [`proposed ${e.proposals.map((p) => `${p.goalId} ${p.contact} ${p.as}`).join(', ')}`];
  if (e.kind !== 'thread-decided') return [];
  return [`${e.goalId} ${e.contact} ${e.as}${e.note ? ` ${e.note}` : ''}${e.spunOff ? ` as “${e.spunOff.title}”` : ''}${e.proposed ? ' as proposed' : ''}`];
};

/** The plugin on a ledger of two closed goals, its model answering through `later`; `ledger` and the goals `started` are what a restart keeps. */
function life(later: Later, ledger: LedgerEvent[], started: string[] = []): Running<Kept> {
  let shown: PluginState<ThreadsState> | undefined;
  const host: ThreadsHost = {
    // unsaved, as the plugin asks: a restart starts it afresh
    state: <S,>(fresh: () => S) => {
      let now = fresh();
      const kept: PluginState<S> = { get: () => now, set: (patch) => void (now = { ...now, ...patch }) };
      shown = kept as unknown as PluginState<ThreadsState>;
      return kept;
    },
    ledger: () => [...ledger],
    record: (projectId: string, entry: LedgerEntry) => {
      const line = { ...entry, projectId, at: 1000 + ledger.length, seq: ledger.length + 1 } as LedgerEvent;
      ledger.push(line);
      parts.ledgerRecorded?.(line);
      return undefined;
    },
    agents: () => [],
    on: () => true,
    demo: false,
    settings: () => ({}) as never,
    readOnlySession: () => later('the model sorts', () => Promise.resolve(ANSWER)),
    toast: () => undefined,
    goals: {
      start: (_projectId, text) => {
        started.push(text);
        return { queued: { id: `q${started.length}`, text, at: 0 } };
      },
    },
  };
  const parts: PluginParts = threadsParts(host);
  const route = (path: string) => (body: Record<string, unknown>) => parts.routes?.find((r) => r.path === path)?.handle({ body: { projectId: 'shop', ...body }, query: {}, params: {} });
  const [decide, spinOff, sort, accept] = ['/decide', '/spin-off', '/sort', '/accept'].map(route);
  return {
    actions: () => [
      ...THREADS_SEEN.flatMap(([g, c]) => DECISIONS.map(([as, note]) => ({ name: `${as} ${g} ${c}`, run: () => decide?.({ goal: g, contact: c, as, note }) }))),
      ...THREADS_SEEN.map(([g, c]) => ({ name: `spin off ${g} ${c}`, run: () => spinOff?.({ goal: g, contact: c, text: `Goal from ${g} ${c}` }) })),
      { name: 'sort for me', run: () => sort?.({}) },
      { name: 'accept the drops', run: () => accept?.({ as: 'dropped' }) },
      ...THREADS_SEEN.map(([g, c]) => ({ name: `accept ${g} ${c}`, run: () => accept?.({ goal: g, contact: c }) })),
      // reopened and closed again, its c2 still open and c1 pursued: what was decided of c2 stays
      { name: 'g1 closes again', run: () => host.record('shop', { kind: 'goal-closed', goal: { ...goal('g1', ['c2'], 900) } }) },
    ],
    durable: () => ({
      lines: ledger.flatMap(lineOf),
      register: (shown?.get().closed.shop ?? []).map((t) =>
        `${t.goal} ${t.idea ? 'idea' : t.contact} ${t.decided?.spunOff ? 'spun off' : t.decided?.as ?? 'to decide'}${t.proposed ? `, ${t.proposed.as} proposed` : ''}`),
      goals: [...started],
    }),
    // the sort's line is written as its answer comes back, a turn of the event loop after `later` lets it go
    settle: () => new Promise((resolve) => setImmediate(resolve)),
    restart: (again) => life(again, ledger, started),
  };
}

const threads: Subject<Kept> = {
  name: 'threads',
  start: (later) => life(later, [
    { seq: 1, at: 100, projectId: 'shop', kind: 'goal-closed', goal: goal('g1', ['c1', 'c2'], 100) },
    { seq: 2, at: 200, projectId: 'shop', kind: 'goal-closed', goal: goal('g2', ['c1'], 200, ['Ship the second firm']) },
  ]),
};

const take = (r: Running<Kept>, name: string) => {
  try {
    r.actions().find((a) => a.name === name)?.run();
  } catch {
    // refused: as if never taken
  }
};
const nothingWaits: Later = () => Promise.reject(new Error('nothing waits'));
const answersAtOnce: Later = (_label, work) => work();

describe('the threads plugin, under Focus’s two rules', () => {
  it('ends a restart as if a decision or a sort had never started, or had finished', async () => {
    await checkRestart(threads, { runs: 25 });
  });

  it('ends two decisions or sorts at once as one after the other would', async () => {
    await checkAtOnce(threads, { runs: 25 });
  });

  it('reaches threads decided every way, spun off, taken back, and kept through their goal closing again', async () => {
    const r = await threads.start(nothingWaits);
    for (const name of ['parked g1 c2', 'dropped g2 c1', 'next g1 c1', 'g1 closes again', 'resolved g2 c1', 'open g2 c1']) take(r, name);
    expect(r.durable().register).toEqual(['g2 c1 to decide', 'g2 idea to decide', 'g1 c2 parked']);
    take(r, 'spin off g1 c2');
    expect(r.durable().register).toEqual(['g2 c1 to decide', 'g2 idea to decide', 'g1 c2 spun off']);
  });

  it('reaches threads proposed by a sort, and accepted one by one and all of an end at once', async () => {
    const r = await threads.start(answersAtOnce);
    take(r, 'sort for me');
    await r.settle();
    expect(r.durable().register).toEqual(['g1 c1 to decide, dropped proposed', 'g1 c2 to decide', 'g2 c1 to decide, resolved proposed', 'g2 idea to decide']);
    take(r, 'accept g2 c1');
    take(r, 'accept the drops');
    expect(r.durable().lines.slice(1)).toEqual(['g2 c1 resolved by #12 as proposed', 'g1 c1 dropped stale as proposed']);
  });

  // README.md: "a thread is spun off once, its goal and its line together"
  it('spins a thread off once, its goal started and its line written together, however often it’s pressed', async () => {
    const r = await threads.start(nothingWaits);
    take(r, 'spin off g2 c1');
    take(r, 'spin off g2 c1');
    const kept = (await r.restart(nothingWaits)).durable();
    expect([kept.goals, kept.lines]).toEqual([['Goal from g2 c1'], ['g2 c1 next as “Goal from g2 c1”']]);
  });

  // README.md: "Every decision is a line in the ledger … a restart keeps every decision"
  it('keeps every decision through a restart, read back from the ledger', async () => {
    const r = await threads.start(nothingWaits);
    take(r, 'parked g1 c2');
    take(r, 'dropped g2 c1');
    expect((await r.restart(nothingWaits)).durable()).toEqual(r.durable());
  });

  // README.md: "a restart keeps every proposal, and forgets a sort still out"
  it('keeps every proposal through a restart, and forgets a sort still out', async () => {
    const r = await threads.start(answersAtOnce);
    take(r, 'sort for me');
    await r.settle();
    expect((await r.restart(nothingWaits)).durable()).toEqual(r.durable());
    const out = await threads.start(() => new Promise<never>(() => undefined));
    take(out, 'sort for me');
    const after = await out.restart(answersAtOnce);
    expect(after.durable().lines).toEqual([]);
    take(after, 'sort for me');
    await after.settle();
    expect(after.durable().lines).toHaveLength(1);
  });

  // README.md: "the same decision twice writes one line"
  it('writes the same decision once, however often it’s pressed', async () => {
    const r = await threads.start(nothingWaits);
    take(r, 'dropped g2 c1');
    take(r, 'dropped g2 c1');
    expect(r.durable().lines).toEqual(['g2 c1 dropped nobody needs it']);
  });
});
