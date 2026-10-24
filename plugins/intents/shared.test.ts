import { describe, expect, it } from 'vitest';
import type { LedgerEntry, LedgerEvent } from '../../plugin-api/shared';
import { changeLines, type Compass, compassOf, compasses, intentName, itemsOf, MOST_INTENTS, newId } from './shared';

let seq = 0;
const line = (projectId: string, entry: Extract<LedgerEntry, { kind: 'intent' }>): LedgerEvent => ({ ...entry, projectId, seq: ++seq, at: seq * 1000 });
const intent = (id: string, what: string, more: Partial<Extract<LedgerEntry, { kind: 'intent' }>> = {}) =>
  ({ kind: 'intent' as const, id, by: 'the user', what, constraints: [], ...more });
const about = (what: string, constraints: string[] = [], retired?: true) => ({ kind: 'intent' as const, by: 'the user', what, constraints, ...(retired && { retired }) });

describe('a project’s compass, read from the ledger', () => {
  it('holds what the project is for, with its guardrails, and each intent as it last stood, first set first', () => {
    seq = 0;
    const events = [
      line('shop', intent('value', 'Deliver value: goals land')),
      line('shop', about('A shop people trust', ['Never break checkout'])),
      line('shop', intent('quality', 'Quality proven by evidence')),
      line('blog', intent('reach', 'More readers')),
      line('shop', intent('value', 'Deliver value, reliably: goals land', { why: 'sharper' })),
      { seq: ++seq, at: 0, projectId: 'shop', kind: 'intent', goalId: 'g1', goal: 'Checkout', by: 'Lt. Reyes', what: 'a goal’s, not the project’s', constraints: [] } satisfies LedgerEvent,
    ];
    expect(compasses(events)).toEqual({
      shop: {
        about: { what: 'A shop people trust', guardrails: ['Never break checkout'], by: 'the user', at: 2000 },
        intents: [{ id: 'value', what: 'Deliver value, reliably: goals land', why: 'sharper', by: 'the user', at: 5000 }, { id: 'quality', what: 'Quality proven by evidence', by: 'the user', at: 3000 }],
      },
      blog: { intents: [{ id: 'reach', what: 'More readers', by: 'the user', at: 4000 }] },
    });
  });

  it('leaves out an intent retired, and keeps the place it was first set in when it’s brought back', () => {
    seq = 0;
    const events = [
      line('shop', intent('value', 'Deliver value')),
      line('shop', intent('quality', 'Quality')),
      line('shop', about('A shop', ['one'])),
      line('shop', intent('value', 'Deliver value', { retired: true, why: 'merged into quality' })),
      line('shop', intent('reach', 'Reach')),
    ];
    expect(compassOf(events, 'shop').intents.map((i) => i.id)).toEqual(['quality', 'reach']);
    events.push(line('shop', intent('value', 'Value, back again')), line('shop', about('A shop', ['one'], true)));
    expect(compassOf(events, 'shop')).toEqual({ intents: [{ id: 'value', what: 'Value, back again', by: 'the user', at: 6000 }, { id: 'quality', what: 'Quality', by: 'the user', at: 2000 }, { id: 'reach', what: 'Reach', by: 'the user', at: 5000 }] });
  });
});

describe('the words of an intent', () => {
  it('names an intent by what leads it, up to a colon', () => {
    expect(intentName('Deliver value, reliably: each goal lands as a working capability')).toBe('Deliver value, reliably');
    expect(intentName('Each goal lands as a working capability')).toBeUndefined();
    expect(intentName(`${'x'.repeat(70)}: too long to be a name`)).toBeUndefined();
  });

  it('takes one item a line, a list’s bullets and numbers taken off', () => {
    expect(itemsOf('1. Deliver value\n- Quality  proven\n\n• Reach\n  2) Fun ')).toEqual(['Deliver value', 'Quality proven', 'Reach', 'Fun']);
    expect(itemsOf(undefined)).toEqual([]);
  });

  it('gives a new intent an id from its name, or its first words, not one taken', () => {
    expect(newId('Deliver value, reliably: each goal lands', new Set())).toBe('deliver-value-reliably');
    expect(newId('Only what needs me reaches me, nothing lost', new Set(['only-what-needs-me-reaches']))).toBe('only-what-needs-me-reaches-2');
    expect(newId('¡¿?!', new Set())).toBe('intent');
  });
});

describe('what a change to the compass writes', () => {
  const now: Compass = { about: { what: 'A shop', guardrails: ['one'], by: 'the user', at: 1 }, intents: [{ id: 'value', what: 'Deliver value', by: 'the user', at: 1 }] };

  it('adds one intent a line, each with an id of its own, agreed by the user and saying why', () => {
    expect(changeLines(now, { do: 'add', text: '1. Deliver value again\n2. Quality proven by evidence', why: ' from the draft ' })).toEqual({ entries: [
      { kind: 'intent', id: 'deliver-value-again', by: 'the user', what: 'Deliver value again', constraints: [], why: 'from the draft' },
      { kind: 'intent', id: 'quality-proven-by-evidence', by: 'the user', what: 'Quality proven by evidence', constraints: [], why: 'from the draft' },
    ] });
    expect(changeLines(undefined, { do: 'add', text: 'Deliver value' })).toMatchObject({ entries: [{ id: 'deliver-value' }] });
  });

  it('rewords an intent under its id, retires one with its words and why, and sets what the project is for', () => {
    expect(changeLines(now, { do: 'edit', id: 'value', what: 'Deliver value, reliably', why: 'sharper' })).toEqual({ entries: [{ kind: 'intent', id: 'value', by: 'the user', what: 'Deliver value, reliably', constraints: [], why: 'sharper' }] });
    expect(changeLines(now, { do: 'retire', id: 'value', why: 'covered by quality' })).toEqual({ entries: [{ kind: 'intent', id: 'value', by: 'the user', what: 'Deliver value', constraints: [], why: 'covered by quality', retired: true }] });
    expect(changeLines(now, { do: 'about', what: 'A shop people trust', guardrails: '- one\n- two' })).toEqual({ entries: [{ kind: 'intent', by: 'the user', what: 'A shop people trust', constraints: ['one', 'two'] }] });
  });

  it('refuses a change that says nothing new, or nothing at all, and a compass that’s become a task list', () => {
    const refused = (body: Record<string, unknown>) => {
      const made = changeLines(now, body);
      return 'error' in made ? made.error : 'written';
    };
    expect(refused({ do: 'add', text: '\n  \n' })).toBe('Say what the intent is');
    expect(refused({ do: 'add', text: Array.from({ length: MOST_INTENTS }, (_, i) => `Intent ${i}`).join('\n') })).toMatch(/^Keep it to 8 intents/);
    expect(refused({ do: 'add', text: 'x'.repeat(401) })).toMatch(/^Keep it under 400/);
    expect(refused({ do: 'edit', id: 'value', what: 'Deliver value' })).toBe('It says that already');
    expect(refused({ do: 'edit', id: 'gone', what: 'x' })).toBe('That intent isn’t one of this project’s any more');
    expect(refused({ do: 'edit', id: 'value', what: ' ' })).toBe('Say what the intent is, or retire it');
    expect(refused({ do: 'retire', id: 'value', why: '' })).toBe('Say why it’s retired');
    expect(refused({ do: 'about', what: 'A shop', guardrails: 'one' })).toBe('It says that already');
    expect(refused({ do: 'about', what: '', guardrails: 'one' })).toBe('Say what this project’s work is for, in a line');
    expect(refused({ do: 'shout' })).toBe('Add, edit or retire an intent, or say what the project’s for');
  });
});
