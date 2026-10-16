import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EXPLAINER_LIMITS, explainerPage } from './explainer';
import { CONTACT_LIMITS as C } from './contacts';
import { applyNote } from './lead';
import { explainShape, extraTools, noteShape } from './officeTool';

const schema = z.object(noteShape);
const text = (n: number) => 'x'.repeat(n);
const fits = (input: unknown) => schema.safeParse(input).success;

describe('the note tool schema', () => {
  it('puts no limits on the note itself, and the office keeps whatever it takes', () => {
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

describe('the explain tool schema', () => {
  const E = EXPLAINER_LIMITS;
  const explain = z.object(explainShape);
  const beat = { title: 'A beat', text: 'Its caption', seconds: 3 };
  const input = (beats: { title: string; text: string; seconds: number; label?: string }[]) => ({ id: 'x', title: 'X', beats, stage: { html: '', script: 'function render(t) {}' } });

  it('says each limit in its description', () => {
    const beatShape = (explainShape.beats as unknown as z.ZodArray<z.ZodObject<Record<string, z.ZodType>>>).element.shape;
    expect(explainShape.beats.description).toContain(`${E.minBeats} to ${E.maxBeats}`);
    expect(beatShape.title.description).toContain(String(E.beatTitle));
    expect(beatShape.text.description).toContain(String(E.text));
    expect(beatShape.seconds.description).toContain(`${E.minSeconds} to ${E.maxSeconds}`);
    expect(beatShape.label.description).toContain(String(E.label));
  });

  it('takes and refuses the same beats as the office', () => {
    const cases = [
      [beat], [beat, beat], Array.from({ length: E.maxBeats }, () => beat), Array.from({ length: E.maxBeats + 1 }, () => beat),
      [beat, { ...beat, title: text(E.beatTitle) }], [beat, { ...beat, title: text(E.beatTitle + 1) }],
      [beat, { ...beat, text: text(E.text) }], [beat, { ...beat, text: text(E.text + 1) }],
      [beat, { ...beat, label: text(E.label) }], [beat, { ...beat, label: text(E.label + 1) }],
      [beat, { ...beat, seconds: E.minSeconds }], [beat, { ...beat, seconds: E.minSeconds - 0.5 }],
      [beat, { ...beat, seconds: E.maxSeconds }], [beat, { ...beat, seconds: E.maxSeconds + 1 }],
    ];
    for (const beats of cases) expect([beats, explain.safeParse(input(beats)).success]).toEqual([beats, !('error' in explainerPage(input(beats)))]);
  });
});

describe('the plugins\' tools', () => {
  const t = (name: string) => ({ name, description: name, input: {}, run: () => Promise.resolve(name) });

  it('takes those well named and clear of the office\'s own and of each other\'s, the first of a name winning', () => {
    const first = t('map');
    const kept = extraTools([first, t('show'), t('Map Tool'), t('map'), t('trace_view')]);
    expect(kept.map((x) => x.name)).toEqual(['map', 'trace_view']);
    expect(kept[0]).toBe(first);
  });
});
