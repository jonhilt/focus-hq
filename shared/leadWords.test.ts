import { describe, expect, it } from 'vitest';
import type { TermKind } from './types';
import { lastWords, shownThisTurn } from './leadWords';

const line = (kind: TermKind, text: string) => ({ t: 0, kind, text });

describe('lastWords', () => {
  it('is the run of text that ends the turn', () => {
    const lines = [line('text', 'Looking.'), line('tool', 'Read a.ts'), line('text', 'Done the first slice.'), line('text', 'Shall I go on?')];
    expect(lastWords(lines)).toBe('Done the first slice.\nShall I go on?');
  });

  it('looks past what Ops logs after the turn', () => {
    expect(lastWords([line('text', 'Over to you.'), line('success', 'Turn done'), line('system', 'idle')])).toBe('Over to you.');
  });

  it('looks back past the tool call a raised hand is for', () => {
    expect(lastWords([line('tool', 'Read'), line('text', 'Ready to ship.'), line('tool', 'ship')])).toBe('Ready to ship.');
  });

  it('is nothing with nothing said', () => {
    expect(lastWords([line('tool', 'Bash')])).toBe('');
    expect(lastWords([])).toBe('');
  });

  it('keeps the end of a long one, from a whole line', () => {
    const said = lastWords([line('text', 'a'.repeat(50)), line('text', 'b'.repeat(10)), line('text', 'c'.repeat(10))], 25);
    expect(said).toBe(`…\n${'b'.repeat(10)}\n${'c'.repeat(10)}`);
  });
});

describe('shownThisTurn', () => {
  const shown = (id: string, at: number) => ({ id, title: id, at });
  const art = [shown('old', 1), shown('b', 30), shown('a', 20)];

  it('is what the lead showed since the captain last spoke, newest first', () => {
    expect(shownThisTurn(art, [{ t: 10, kind: 'manager', text: '▶ Captain: go' }, line('text', 'Pick one')]).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('is only the latest with no word from the captain in view', () => {
    expect(shownThisTurn(art, [line('text', 'A, B or C?')]).map((a) => a.id)).toEqual(['b']);
  });

  it('looks past Ops’ notes of a hand raised and approved partway through the turn', () => {
    const lines = [
      { t: 10, kind: 'manager' as const, text: '▶ Captain: go' },
      { t: 25, kind: 'manager' as const, text: '✋ Waiting for the captain to approve Bash' },
      { t: 26, kind: 'manager' as const, text: '✔ Approved by the captain: Bash' },
    ];
    expect(shownThisTurn(art, lines).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('is nothing when they showed nothing this turn', () => {
    expect(shownThisTurn(art, [{ t: 40, kind: 'manager', text: '▶ Captain: go' }])).toEqual([]);
    expect(shownThisTurn(undefined, [])).toEqual([]);
  });
});
