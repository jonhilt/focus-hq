import { describe, expect, it } from 'vitest';
import type { Agent, LedgerEvent } from '../../plugin-api/server';
import { checkAtOnce, checkRestart, type Later, focus, type Running, type Subject } from '../../plugin-api/testing';
import { type ChiefHost, ChiefOfStaff, type Judge } from './chief';

// The chief of staff under Focus's two rules (docs/invariants.md): a restart while a turn is being judged ends as
// if it had never been judged or had been, and two ends of turns at once write what one after the other would: each
// turn's verdict once (README.md: "judged once however often it ends").

const said = (uuid: string, text: string) => JSON.stringify({ type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } });

/** Each turn's verdicts, by its last line: once each. */
type Kept = string[];

const chief: Subject<Kept> = {
  name: 'chief of staff',
  start: (later) => {
    const o = focus();
    const settings = o.store.settings;
    // what survives a restart: the ledger, and the lead's transcript
    const ledger: LedgerEvent[] = [];
    const transcript: string[] = [said('t1', 'Slice 1 is up. Shall I start slice 2?')];
    const lead = { id: 'lead', name: 'Cmdr. Vale', task: 'lead', projectId: 'p', sessionId: 's', lead: { title: 'Saved items' } } as unknown as Agent;
    const life = (later: Later): Running<Kept> => {
      const host: ChiefHost = {
        on: () => true,
        transcript: () => Promise.resolve(transcript.join('\n')),
        record: (projectId, entry) => void ledger.push({ ...entry, projectId, at: ledger.length, seq: ledger.length + 1 }),
        ledger: () => [...ledger],
        settings: () => settings,
        goals: { judged: () => undefined },
      };
      // the model answering is a step out there: a restart can fall while it does
      const judge: Judge = { model: 'haiku', judge: () => later('haiku', () => Promise.resolve({ structured: { route: 2, why: 'A pick.', message: '' } })) };
      const cos = new ChiefOfStaff(host, judge, () => undefined);
      let going: Promise<unknown> = Promise.resolve();
      return {
        actions: () => [
          { name: 'the lead’s turn ends', run: () => (going = Promise.all([going, cos.turn(lead, 'end')])) },
          { name: 'the lead says more', run: () => transcript.push(said(`t${transcript.length + 1}`, 'Done. Ship it?')) },
        ],
        durable: () => ledger.flatMap((e) => (e.kind === 'cos-verdict' ? [e.turnUuid] : [])),
        settle: async () => void (await going),
        restart: (l) => life(l),
      };
    };
    return life(later);
  },
};

describe('the chief of staff, under Focus’s two rules', () => {
  it('judges each turn once', async () => {
    const r = await chief.start((_label, work) => work());
    await Promise.all([r.actions()[0].run(), r.actions()[0].run()]);
    await r.settle();
    expect(r.durable()).toEqual(['t1']);
  });

  it('ends a restart as if a judgement had never started, or had finished', async () => {
    await checkRestart(chief, { runs: 15 });
  });

  it('ends two turns at once as one after the other would', async () => {
    await checkAtOnce(chief, { runs: 15 });
  });
});
