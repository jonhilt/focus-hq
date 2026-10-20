import { describe, expect, it } from 'vitest';
import type { TermKind } from '../../../shared/types';
import { focusIndex, lastWords } from './briefing';

const line = (kind: TermKind, text: string) => ({ t: 0, kind, text });

describe('lastWords', () => {
  it('is the run of text that ends the turn', () => {
    const lines = [line('text', 'Looking.'), line('tool', 'Read a.ts'), line('text', 'Done the first slice.'), line('text', 'Shall I go on?')];
    expect(lastWords(lines)).toBe('Done the first slice.\nShall I go on?');
  });

  it('looks past what the office logs after the turn', () => {
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

describe('focusIndex', () => {
  it('is nothing with nothing left', () => {
    expect(focusIndex([], 'a', 0)).toBe(-1);
  });

  it('stays on the item it showed while it’s there, wherever it moved', () => {
    expect(focusIndex(['x', 'a', 'b'], 'a', 0)).toBe(1);
  });

  it('moves on to what took an answered item’s place', () => {
    expect(focusIndex(['a', 'c'], 'b', 1)).toBe(1);
  });

  it('falls back to the last when the answered item was last', () => {
    expect(focusIndex(['a', 'b'], 'c', 2)).toBe(1);
  });

  it('starts at the top', () => {
    expect(focusIndex(['a', 'b'], null, 0)).toBe(0);
  });
});
