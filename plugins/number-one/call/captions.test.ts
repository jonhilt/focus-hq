import { describe, expect, it } from 'vitest';
import type { CallLine } from '../shared';
import { addCaption, MAX_LINES, SAME_LINE_MS } from './captions';

describe('addCaption', () => {
  it('carries a line on with the same speaker’s next fragment, as it comes', () => {
    const lines = addCaption(addCaption([], 'captain', 'What is', 0), 'captain', ' the crew doing?', 400);
    expect(lines).toEqual([{ who: 'captain', text: 'What is the crew doing?', at: 400 }]);
  });

  it('starts a new line for the other speaker, after a pause, and for every office note', () => {
    let lines: CallLine[] = addCaption([], 'captain', 'Status?', 0);
    lines = addCaption(lines, 'ship', ' All quiet.', 100);
    lines = addCaption(lines, 'ship', 'Anything else?', 100 + SAME_LINE_MS);
    lines = addCaption(addCaption(lines, 'office', 'One', 0), 'office', 'Two', 0);
    expect(lines.map((l) => [l.who, l.text])).toEqual([
      ['captain', 'Status?'],
      ['ship', 'All quiet.'],
      ['ship', 'Anything else?'],
      ['office', 'One'],
      ['office', 'Two'],
    ]);
  });

  it('skips a blank fragment that would start a line, and keeps the latest lines', () => {
    expect(addCaption([], 'ship', '  ', 0)).toEqual([]);
    const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => i).reduce<CallLine[]>((lines, i) => addCaption(lines, 'office', `${i}`, i), []);
    expect(many).toHaveLength(MAX_LINES);
    expect(many.at(-1)?.text).toBe(`${MAX_LINES + 4}`);
  });
});
