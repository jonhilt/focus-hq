import { describe, expect, it } from 'vitest';
import type { LedgerEntry, LedgerEvent, PluginParts, PluginState } from '../../plugin-api/server';
import { checkAtOnce, checkRestart, type Running, type Subject } from '../../plugin-api/testing';
import { type IntentsHost, intentsParts } from './server';
import type { IntentsState } from './shared';

// The intents plugin under Focus's two rules (docs/invariants.md): a restart is atomic, and two changes at once end as
// one after the other would. What it keeps across a restart is the ledger alone: a project's compass, as it shows it,
// is read back from its intent lines. It's described here (what it can do, what must survive), not told what to expect.
//
// Its stand-in: the host's ledger is an array, written and heard (`ledgerRecorded`) at once, as Focus's is. Nothing
// waits on the world outside: a change is checked and its lines written in one step, so no restart falls between its
// lines, and two changes at once can't interleave.
//
// Breaks seen caught: a change shown in the compass without its ledger line fails the restart check, the reach test and
// both promises; a change written half (its first line and not the rest) fails the reach test and the promise that a
// change is written whole (not the restart check: no restart falls between a change's lines).

/** What must survive: every intent line in the ledger, and the compass as the plugin shows it. */
interface Kept {
  lines: string[];
  compass: string[];
}

const lineOf = (e: LedgerEvent): string[] =>
  e.kind === 'intent' ? [`${e.id ?? 'about'} ${e.retired ? 'retired' : e.what}${e.constraints.length ? ` [${e.constraints.join('; ')}]` : ''}${e.why ? ` because ${e.why}` : ''}`] : [];

/** The plugin on `ledger`, which a restart keeps. */
function life(ledger: LedgerEvent[]): Running<Kept> {
  let shown: PluginState<IntentsState> | undefined;
  const host: IntentsHost = {
    // unsaved, as the plugin asks: a restart starts it afresh
    state: <S,>(fresh: () => S) => {
      let now = fresh();
      const kept: PluginState<S> = { get: () => now, set: (patch) => void (now = { ...now, ...patch }) };
      shown = kept as unknown as PluginState<IntentsState>;
      return kept;
    },
    ledger: () => [...ledger],
    record: (projectId: string, entry: LedgerEntry) => {
      const line = { ...entry, projectId, at: 1000 + ledger.length, seq: ledger.length + 1 } as LedgerEvent;
      ledger.push(line);
      parts.ledgerRecorded?.(line);
    },
    on: () => true,
  };
  const parts: PluginParts = intentsParts(host);
  const change = (body: Record<string, unknown>) => parts.routes?.find((r) => r.path === '/change')?.handle({ body: { projectId: 'shop', ...body }, query: {}, params: {} });
  const ids = () => (shown?.get().compasses.shop?.intents ?? []).map((i) => i.id);
  return {
    actions: () => [
      { name: 'add two', run: () => change({ do: 'add', text: 'Deliver value: orders arrive\nMore shoppers', why: 'drafted' }) },
      { name: 'add one', run: () => change({ do: 'add', text: 'Quality proven' }) },
      { name: 'say what it’s for', run: () => change({ do: 'about', what: 'A shop people trust', guardrails: 'Never break checkout\nBuild only what’s asked' }) },
      { name: 'say it again, changed', run: () => change({ do: 'about', what: 'A shop people trust', guardrails: 'Never break checkout', why: 'one guardrail' }) },
      ...['deliver-value', 'more-shoppers', 'quality-proven'].flatMap((id) => [
        { name: `reword ${id}`, run: () => change({ do: 'edit', id, what: `${id}, reworded`, why: 'sharper' }) },
        { name: `retire ${id}`, run: () => change({ do: 'retire', id, why: 'done' }) },
      ]),
      { name: 'reword the first', run: () => ids()[0] && change({ do: 'edit', id: ids()[0], what: 'The first, again' }) },
    ],
    durable: () => ({
      lines: ledger.flatMap(lineOf),
      compass: [
        ...(shown?.get().compasses.shop?.about ? [`for ${shown.get().compasses.shop?.about?.what} [${shown.get().compasses.shop?.about?.guardrails.join('; ')}]`] : []),
        ...(shown?.get().compasses.shop?.intents ?? []).map((i) => `${i.id}: ${i.what}`),
      ],
    }),
    settle: () => Promise.resolve(),
    restart: () => life(ledger),
  };
}

const intents: Subject<Kept> = { name: 'intents', start: () => life([]) };

const take = (r: Running<Kept>, name: string) => {
  try {
    r.actions().find((a) => a.name === name)?.run();
  } catch {
    // refused: as if never taken
  }
};

describe('the intents plugin, under Focus’s two rules', () => {
  it('ends a restart as if a change had never started, or had finished', async () => {
    await checkRestart(intents, { runs: 25 });
  });

  it('ends two changes at once as one after the other would', async () => {
    await checkAtOnce(intents, { runs: 25 });
  });

  it('reaches a compass said, added to, reworded and retired from', async () => {
    const r = await intents.start(() => Promise.reject(new Error('nothing waits')));
    for (const name of ['add two', 'say what it’s for', 'reword more-shoppers', 'add one', 'retire deliver-value', 'say it again, changed']) take(r, name);
    expect(r.durable().compass).toEqual(['for A shop people trust [Never break checkout]', 'more-shoppers: more-shoppers, reworded', 'quality-proven: Quality proven']);
  });

  // README.md: "a restart keeps every intent, as it was agreed"
  it('keeps every intent through a restart, read back from the ledger', async () => {
    const r = await intents.start(() => Promise.reject(new Error('nothing waits')));
    for (const name of ['add two', 'say what it’s for', 'reword deliver-value', 'retire more-shoppers']) take(r, name);
    expect((await r.restart(() => Promise.reject(new Error('nothing waits')))).durable()).toEqual(r.durable());
  });

  // README.md: "a change is written whole: every line it writes, or none"
  it('writes a change whole, every intent it adds or none, and the same change twice once', async () => {
    const r = await intents.start(() => Promise.reject(new Error('nothing waits')));
    take(r, 'add two');
    expect(r.durable().lines).toEqual(['deliver-value Deliver value: orders arrive because drafted', 'more-shoppers More shoppers because drafted']);
    take(r, 'say what it’s for');
    take(r, 'say what it’s for');
    expect(r.durable().lines).toHaveLength(3);
  });
});
