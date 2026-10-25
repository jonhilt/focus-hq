import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../plugin-api/shared';
import { CAPTAIN_WORDS, captainWords, contextText, turnContext } from './context';

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n');
const said = (uuid: string, text: string) => ({ type: 'assistant', uuid, message: { content: [{ type: 'text', text }] } });
const to = (uuid: string, text: string, isMeta = false) => ({ type: 'user', uuid, isMeta, message: { content: text } });

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
  it('keeps the captain’s own messages after the first, oldest first, leaving out Ops’, QA’s and the harness’s', () => {
    const t = jsonl([
      to('a', 'Build saved items'),
      said('b', 'Plan?'),
      to('c', 'Not yet: let me review the plan first.'),
      to('d', '[Ops] Slice 1 landed.'),
      to('e', '[QA officer] Passed.'),
      to('f', '<system-reminder>todo</system-reminder>'),
      to('g', 'meta', true),
      to('h', 'Go with the list.'),
    ]);
    expect(captainWords(t)).toEqual(['Not yet: let me review the plan first.', 'Go with the list.']);
  });

  it('keeps the latest few, each clipped', () => {
    const t = jsonl([to('a', 'Start'), ...Array.from({ length: CAPTAIN_WORDS.count + 3 }, (_, i) => to(`m${i}`, `reply ${i}`)), to('z', 'x'.repeat(CAPTAIN_WORDS.chars + 10))]);
    const words = captainWords(t);
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
    const c = turnContext(lead, ledger, jsonl([to('a', 'Build saved items'), to('b', 'Use a list.')]));
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
    const c = turnContext({ id: 'g9', projectId: 'p', lead: { title: '' } }, [], '');
    expect(contextText(c)).toBe('GOAL: (untitled)');
  });
});
