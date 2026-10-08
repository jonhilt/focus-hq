import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EXPLAINER_LIMITS, explainerPage } from './explainer';
import { applyNote, NOTE_LIMITS } from './lead';
import { explainShape, noteShape } from './officeTool';

const L = NOTE_LIMITS;
const schema = z.object(noteShape);
const text = (n: number) => 'x'.repeat(n);
const fits = (input: unknown) => schema.safeParse(input).success;
const officeTakes = (input: Parameters<typeof applyNote>[1]) => !('error' in applyNote({ title: 'Goal' }, input));

describe('the note tool schema', () => {
  it('carries the limits the office enforces, as JSON schema the lead sees', () => {
    const json = z.toJSONSchema(schema) as { properties: Record<string, { maxLength?: number; maxItems?: number; items?: { maxLength?: number; properties?: { text: { maxLength?: number } } } }> };
    const p = json.properties;
    expect(p.title.maxLength).toBe(L.title);
    expect(p.done.maxLength).toBe(L.done);
    expect(p.slice.maxItems).toBe(L.slice);
    expect(p.slice.items?.properties?.text.maxLength).toBe(L.item);
    expect(p.learned.maxLength).toBe(L.line);
    expect(p.allLearned.maxItems).toBe(L.learned);
    expect(p.allLearned.items?.maxLength).toBe(L.line);
    expect(p.next.maxItems).toBe(L.next);
    expect(p.next.items?.maxLength).toBe(L.item);
  });

  it('says each limit in its description', () => {
    const says = (field: keyof typeof noteShape, ...numbers: number[]) => numbers.forEach((n) => expect(noteShape[field].description).toContain(String(n)));
    says('title', L.title);
    says('done', L.done);
    says('slice', L.slice, L.item);
    says('learned', L.line);
    says('allLearned', L.learned, L.line);
    says('next', L.next, L.item);
  });

  it('takes and refuses the same notes as the office', () => {
    const cases: Parameters<typeof applyNote>[1][] = [
      { title: text(L.title) }, { title: text(L.title + 1) },
      { done: text(L.done) }, { done: text(L.done + 1) },
      { slice: Array.from({ length: L.slice }, () => ({ text: 'a' })) }, { slice: Array.from({ length: L.slice + 1 }, () => ({ text: 'a' })) },
      { slice: [{ text: text(L.item) }] }, { slice: [{ text: text(L.item + 1) }] },
      { learned: text(L.line) }, { learned: text(L.line + 1) },
      { allLearned: Array.from({ length: L.learned }, () => 'a') }, { allLearned: Array.from({ length: L.learned + 1 }, () => 'a') },
      { allLearned: [text(L.line)] }, { allLearned: [text(L.line + 1)] },
      { next: Array.from({ length: L.next }, () => 'a') }, { next: Array.from({ length: L.next + 1 }, () => 'a') },
      { next: [text(L.item)] }, { next: [text(L.item + 1)] },
    ];
    for (const input of cases) expect([input, fits(input)]).toEqual([input, officeTakes(input)]);
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
