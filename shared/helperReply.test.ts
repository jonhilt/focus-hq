import { describe, expect, it } from 'vitest';
import { lastWords } from './leadWords';
import { entryLines } from './stepText';
import { lastReply, replyPart, termBlocks } from './termText';
import type { TermEntry } from './types';

// A subagent's reply kept in the session's own transcript (marked `helper`, when the session keeps none apart for it)
// is the subagent's, not the session's: drawn as output, it's never read as part of what the session said.

const entries: TermEntry[] = [
  { kind: 'reply', text: 'lead says hi' },
  { kind: 'reply', text: 'helper finding', helper: 'h1' },
];

describe('a helper reply kept in the session transcript', () => {
  it('is not read as part of the lead reply (as before, it was drawn as output)', () => {
    const lines = entries.flatMap(entryLines);
    expect(lines.filter((l) => replyPart(l) !== null && l.text.includes('helper finding'))).toEqual([]);
  });

  it('does not become the lead last words', () => {
    expect(lastReply(entries)).toBe('lead says hi');
  });

  it('is not merged into the lead reply block', () => {
    const blocks = termBlocks(entries);
    expect(blocks.filter((b) => b.kind === 'reply')).toHaveLength(1);
    expect(JSON.stringify(blocks[0])).not.toContain('helper finding');
  });
});

describe('lastWords with a helper reply after the lead reply', () => {
  it('quotes only the lead', () => {
    expect(lastWords(entries)).not.toContain('helper finding');
  });
});
