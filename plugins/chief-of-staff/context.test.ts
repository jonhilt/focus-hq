import { describe, expect, it } from 'vitest';
import type { LedgerEvent, TermLine } from '../../plugin-api/shared';
import { CAPTAIN_WORDS, captainWords, contextText, turnContext } from './context';

const msg = (t: number, text: string): TermLine => ({ t, kind: 'manager', text });

let seq = 0;
const line = (e: Record<string, unknown>): LedgerEvent => ({ projectId: 'p', at: ++seq, seq, ...e }) as LedgerEvent;
const decision = (id: string, o: Record<string, unknown>) =>
  line({ kind: 'decision', id, status: 'open', goalId: 'g1', goal: 'Saved items', owner: 'Lt. Vale', by: 'Lt. Vale', question: `${id}?`, options: ['A', 'B'], ...o });

const lead = {
  id: 'g1',
  projectId: 'p',
  lead: { title: 'Saved items', brief: 'Let shoppers save items for later.', note: { done: 'A shopper saves an item and finds it next visit.', learned: [], next: [] } },
};

describe('captainWords', () => {
  it('keeps the captain’s own messages from the lead’s log, oldest first, leaving out the goal as first put and everyone else’s', () => {
    const lines = [
      msg(1, '▶ Captain: Build saved items'),
      { t: 2, kind: 'text' as const, text: 'Plan?' },
      msg(3, '▶ Captain: Not yet: let me review the plan first.'),
      msg(4, '▶ Ops: Slice 1 landed.'),
      msg(5, '▶ QA officer Lt. Okafor: Passed.'),
      msg(6, '▶ Captain, from phone: Go with the list.'),
    ];
    expect(captainWords(lines, 'Build saved items')).toEqual(['Not yet: let me review the plan first.', 'Go with the list.']);
  });

  it('keeps the captain’s reply that came with a QA note: in the transcript the two are one message', () => {
    // the transcript had “[QA officer …] QA passed … \n\nok great, try B” as one user message, read as QA’s
    const lines = [msg(1, '▶ QA officer Lt. Nakamura: QA passed acme/shop#3'), msg(2, '▶ Captain: ok great, try B')];
    expect(captainWords(lines)).toEqual(['ok great, try B']);
  });

  it('keeps the latest few, each clipped', () => {
    const lines = [...Array.from({ length: CAPTAIN_WORDS.count + 3 }, (_, i) => msg(i, `▶ Captain: reply ${i}`)), msg(99, `▶ Captain: ${'x'.repeat(CAPTAIN_WORDS.chars + 10)}`)];
    const words = captainWords(lines);
    expect(words).toHaveLength(CAPTAIN_WORDS.count);
    expect(words[0]).toBe('reply 4');
    expect(words.at(-1)).toBe(`${'x'.repeat(CAPTAIN_WORDS.chars)} …[+10]`);
  });
});

describe('turnContext', () => {
  it('reads what’s agreed for the goal, the project’s compass and the captain’s words', () => {
    const ledger = [
      line({ kind: 'intent', by: 'the user', what: 'A webshop shoppers trust', constraints: ['Never break checkout'] }),
      line({ kind: 'intent', id: 'fast', by: 'the user', what: 'Checkout in seconds', constraints: [] }),
      line({ kind: 'intent', id: 'gone', by: 'the user', what: 'Retired', constraints: [], retired: true }),
      line({ kind: 'intent', goalId: 'g1', by: 'the user', what: 'A goal’s own', constraints: [] }),
      decision('d1', { proposed: 'A' }),
      decision('d1', { status: 'decided', chosen: 'A' }),
      decision('d2', { proposed: 'B' }),
      decision('d3', { goalId: 'other' }),
      line({ kind: 'intent', projectId: 'q', by: 'the user', what: 'Another project', constraints: [] }),
    ];
    const c = turnContext(lead, ledger, [msg(1, '▶ Captain: Let shoppers save items for later.'), msg(2, '▶ Captain: Use a list.')]);
    expect(c).toEqual({
      goal: 'Saved items',
      firstWords: 'Let shoppers save items for later.',
      done: 'A shopper saves an item and finds it next visit.',
      project: { what: 'A webshop shoppers trust', guardrails: ['Never break checkout'] },
      intents: ['Checkout in seconds'],
      decided: [{ question: 'd1?', chosen: 'A' }],
      open: [{ question: 'd2?', proposed: 'B' }],
      captainSaid: ['Use a list.'],
    });
    expect(contextText(c)).toBe(
      [
        'GOAL: Saved items',
        'The captain\'s first words:\nLet shoppers save items for later.',
        'What done looks like:\nA shopper saves an item and finds it next visit.',
        'THE PROJECT: A webshop shoppers trust\nGuardrails:\n- Never break checkout',
        'The project\'s intents:\n- Checkout in seconds',
        'DECIDED (agreed):\n- d1? → A',
        'OPEN DECISIONS (not agreed yet):\n- d2? (the lead proposes: B)',
        'THE CAPTAIN\'S LATEST WORDS TO THE LEAD (oldest first):\n- Use a list.',
      ].join('\n\n'),
    );
  });

  it('leaves out what the goal doesn’t have', () => {
    const c = turnContext({ id: 'g9', projectId: 'p', lead: { title: '' } }, [], []);
    expect(contextText(c)).toBe('GOAL: (untitled)');
  });
});
