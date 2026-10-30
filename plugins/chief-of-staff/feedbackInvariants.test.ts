import { describe, expect, it } from 'vitest';
import type { Agent, LedgerEvent, PluginState } from '../../plugin-api/server';
import { checkAtOnce, checkRestart, type Later, type Running, type Subject } from '../../plugin-api/testing';
import { Feedback, type FeedbackHost } from './feedback';
import { feedbackPressed } from './feedbackRules';
import type { CosLive } from './shared';

// The user's one-tap word on a lead's turn (README.md#didnt-need-me-and-you-should-have-asked-me) under Focus's two
// rules (docs/invariants.md#describing-a-part): it keeps its lines in the ledger, and reads the lead's transcript (a
// file Claude Code writes) to place a turn the chief of staff never judged. A restart mid-press ends with the press
// recorded or not, never half; two presses at once end as one after the other: pressed, then taken back. What's shown
// pressed is always what the ledger says. Breaks seen caught: deciding on the ledger as it was before the transcript's
// read (two presses at once both pressed it: the at-once rule and its promise), and not reading what's pressed again
// as it starts (the restart rule and the reload promise). Its stand-in for the transcript is a fixed file: what it
// can't tell is a turn whose lines Claude Code hadn't written yet when the press came.

const said = (uuid: string, text: string) => JSON.stringify({ type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } });

/** What must survive: what the ledger says is pressed, and what every browser is shown pressed, which must agree. */
type Kept = { ledger: Record<string, string[]>; shown: Record<string, string[]> };

const feedback: Subject<Kept> = {
  name: 'the user’s word on a turn',
  start: (later) => {
    // what survives a restart: the ledger, and the lead's transcript; what browsers are shown is read again
    const ledger: LedgerEvent[] = [
      { kind: 'cos-verdict', sessionId: 's', agent: 'Cmdr. Vale', turnUuid: 't1', route: 2, why: 'A pick.', model: 'haiku', version: 'v9', projectId: 'p', at: 0, seq: 1 },
    ];
    const transcript = [said('t1', 'Slice 1 is up. Shall I start slice 2?'), said('t2', 'Started slice 2 without asking.')].join('\n');
    const lead = { id: 'lead', name: 'Cmdr. Vale', task: 'lead', projectId: 'p', sessionId: 's', lead: { title: 'Saved items' } } as unknown as Agent;
    const life = (later: Later): Running<Kept> => {
      let live: CosLive = { lineActivity: '' };
      const state: PluginState<CosLive> = { get: () => live, set: (patch) => void (live = { ...live, ...patch }) };
      const host: FeedbackHost = {
        agent: (id) => (id === lead.id ? lead : undefined),
        // reading the transcript is a step out there: a restart can fall while it does
        transcript: () => later('transcript', () => Promise.resolve(transcript)),
        ledger: () => [...ledger],
        record: (projectId, entry) => void ledger.push({ ...entry, projectId, at: ledger.length, seq: ledger.length + 1 }),
      };
      const fb = new Feedback(host, state);
      let going: Promise<unknown> = Promise.resolve();
      const press = (turnUuid: string, signal: string, via: string) => () => (going = Promise.all([going, fb.press({ agentId: lead.id, turnUuid, signal, via }).catch(() => undefined)]));
      return {
        actions: () => [
          { name: 'the user presses Didn’t need me on the judged card', run: press('t1', 'not-needed', 'comms') },
          { name: 'the user presses You should have asked me on the card', run: press('t1', 'should-have-asked', 'phone') },
          { name: 'the user presses You should have asked me on a message in Talk the chief of staff never judged', run: press('t2', 'should-have-asked', 'talk') },
        ],
        durable: () => ({ ledger: feedbackPressed(ledger), shown: live.feedback ?? {} }),
        settle: async () => void (await going),
        restart: (l) => life(l),
      };
    };
    return life(later);
  },
};

const run = async (presses: number[]) => {
  const r = await feedback.start((_label, work) => work());
  for (const i of presses) await r.actions()[i].run();
  await r.settle();
  return r;
};

describe('the user’s word on a turn, under Focus’s two rules', () => {
  // README.md: "Pressing it again takes it back"
  it('takes a press back when it’s pressed again, and presses it again after that', async () => {
    expect((await run([0])).durable().ledger).toEqual({ 's:t1': ['not-needed'] });
    expect((await run([0, 0])).durable().ledger).toEqual({});
    expect((await run([0, 0, 0])).durable().ledger).toEqual({ 's:t1': ['not-needed'] });
  });

  // README.md: "each signal is pressed and taken back on its own"
  it('keeps the two signals on a turn apart', async () => {
    expect((await run([0, 1, 0])).durable().ledger).toEqual({ 's:t1': ['should-have-asked'] });
  });

  // README.md: "shown pressed from the ledger, so a reload or a restart shows the same"
  it('shows what the ledger says is pressed, after a restart too', async () => {
    const r = await run([0, 2]);
    expect(r.durable().shown).toEqual({ 's:t1': ['not-needed'], 's:t2': ['should-have-asked'] });
    const again = await r.restart((_label, work) => work());
    expect(again.durable()).toEqual(r.durable());
  });

  it('ends two presses of the same at once as one after the other: pressed, then taken back', async () => {
    const r = await feedback.start((_label, work) => work());
    await Promise.all([r.actions()[2].run(), r.actions()[2].run()]);
    await r.settle();
    expect(r.durable()).toEqual({ ledger: {}, shown: {} });
  });

  it('ends a restart as if a press had never started, or had finished', async () => {
    await checkRestart(feedback, { runs: 15 });
  });

  it('ends two presses at once as one after the other would', async () => {
    await checkAtOnce(feedback, { runs: 15 });
  });
});
