import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTACT_LIMITS as C } from './contacts';
import { applyNote } from './lead';
import { extraTools, noteShape } from './opsTool';

const schema = z.object(noteShape);
const text = (n: number) => 'x'.repeat(n);
const fits = (input: unknown) => schema.safeParse(input).success;

describe('the note tool schema', () => {
  it('puts no limits on the note itself, and Ops keeps whatever it takes', () => {
    const json = z.toJSONSchema(schema) as { properties: Record<string, { maxLength?: number; maxItems?: number; items?: { maxLength?: number } }> };
    const p = json.properties;
    expect(Object.keys(p).sort()).toEqual(['allLearned', 'closeContact', 'contact', 'done', 'learned', 'next', 'title']);
    for (const field of ['title', 'done', 'learned', 'allLearned', 'next']) {
      expect(p[field].maxLength).toBeUndefined();
      expect(p[field].maxItems).toBeUndefined();
      expect(p[field].items?.maxLength).toBeUndefined();
    }
    const long = { title: text(500), done: text(1000), learned: text(500), next: Array.from({ length: 12 }, () => text(300)) };
    expect(fits(long)).toBe(true);
    expect(applyNote({ title: 'Goal' }, long).note.next).toHaveLength(12);
  });

  it('keeps the limits on contacts, which the lead sees up front', () => {
    expect(fits({ contact: text(C.text) })).toBe(true);
    expect(fits({ contact: text(C.text + 1) })).toBe(false);
    expect(fits({ closeContact: { id: 'c1', as: 'dropped', why: text(C.why + 1) } })).toBe(false);
    expect(noteShape.contact.description).toContain(String(C.text));
  });
});

describe('the plugins\' tools', () => {
  const t = (name: string) => ({ name, description: name, input: {}, run: () => Promise.resolve(name) });

  it('takes those well named and clear of Ops\' own and of each other\'s, the first of a name winning', () => {
    const first = t('map');
    const kept = extraTools([first, t('show'), t('Map Tool'), t('map'), t('trace_view')]);
    expect(kept.map((x) => x.name)).toEqual(['map', 'trace_view']);
    expect(kept[0]).toBe(first);
  });
});
