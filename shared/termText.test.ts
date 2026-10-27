import { describe, expect, it } from 'vitest';
import type { TermLine } from './types';
import { foldSummary, lastReply, plainMarkdown, replyPart, saysLine, sentLine, termBlocks } from './termText';

describe('replyPart', () => {
  it('starts a reply at the marker and carries it on through indented text lines', () => {
    expect(replyPart({ t: 0, kind: 'text', text: '⏺ **Done.** Here it is:' })).toEqual({ start: true, text: '**Done.** Here it is:' });
    expect(replyPart({ t: 0, kind: 'text', text: '  - one' })).toEqual({ start: false, text: '- one' });
    expect(replyPart({ t: 0, kind: 'text', text: '    nested' })).toEqual({ start: false, text: '  nested' });
  });

  it('leaves everything that is not Claude talking alone', () => {
    expect(replyPart({ t: 0, kind: 'tool', text: '⏺ Bash(ls)' })).toBeNull();
    expect(replyPart({ t: 0, kind: 'manager', text: '▶ Captain: **hi**' })).toBeNull();
  });
});

describe('plainMarkdown', () => {
  it('drops the marks and keeps the words', () => {
    expect(plainMarkdown('## Summary')).toBe('Summary');
    expect(plainMarkdown('Run **`npm test`** and see [the docs](https://x.dev).')).toBe('Run npm test and see the docs.');
    expect(plainMarkdown('an *emphasised* word, a_snake_case name and 2 * 3 * 4')).toBe('an emphasised word, a_snake_case name and 2 * 3 * 4');
  });

  it('turns bullets and checkboxes into marks a canvas can draw', () => {
    expect(plainMarkdown('- one')).toBe('• one');
    expect(plainMarkdown('  * nested')).toBe('  • nested');
    expect(plainMarkdown('- [x] done')).toBe('☑ done');
    expect(plainMarkdown('- [ ] not yet')).toBe('☐ not yet');
  });

  it('draws a table rule as a line and hides code fences', () => {
    expect(plainMarkdown('|---|:---:|')).toBe('─'.repeat(11));
    expect(plainMarkdown('```ts')).toBe('');
    expect(plainMarkdown('| a | b |')).toBe('| a | b |');
  });
});

describe('lastReply', () => {
  it('is the last reply, without its markdown, up to the next tool call', () => {
    expect(lastReply([
      { t: 0, kind: 'text', text: '⏺ First thoughts' },
      { t: 1, kind: 'tool', text: '⏺ Bash(npm test)' },
      { t: 2, kind: 'text', text: '⏺ Slice **shipped**.' },
      { t: 3, kind: 'text', text: '  - QA passed' },
      { t: 4, kind: 'text', text: '  ' },
      { t: 5, kind: 'system', text: '✻ Turn ended' },
    ])).toBe('Slice shipped.\n• QA passed');
  });

  it('is empty before Claude has said anything', () => {
    expect(lastReply([{ t: 0, kind: 'manager', text: '▶ Captain: hello' }])).toBe('');
  });
});

describe('saysLine', () => {
  it("keeps Claude's replies and the messages it was sent out of the fold, and folds the rest", () => {
    const kinds = ['text', 'manager', 'system', 'thinking', 'tool', 'output', 'error', 'success'] as const;
    expect(kinds.filter((kind) => saysLine({ t: 0, kind, text: '' }))).toEqual(['text', 'manager']);
  });
});

describe('sentLine', () => {
  it('tells a message sent to the session from a notice about it', () => {
    expect(sentLine({ t: 0, kind: 'manager', text: '▶ Captain: try the other layout' })).toBe(true);
    expect(sentLine({ t: 0, kind: 'manager', text: '❓ Asked the captain: Which layout? (A: Cards · B: List)' })).toBe(false);
    expect(sentLine({ t: 0, kind: 'manager', text: '✋ Waiting for the captain to approve git push' })).toBe(false);
    expect(sentLine({ t: 0, kind: 'text', text: '▶ not a message' })).toBe(false);
  });
});

describe('foldSummary', () => {
  it('counts the tool calls and names the latest step', () => {
    expect(foldSummary([
      { t: 0, kind: 'tool', text: '⏺ Read(CLAUDE.md)' },
      { t: 1, kind: 'output', text: '  ⎿  Read 78 lines' },
      { t: 2, kind: 'thinking', text: '✻ Thinking…' },
      { t: 3, kind: 'tool', text: '⏺ Write(brief.md)' },
      { t: 4, kind: 'success', text: '  + # Brief' },
    ])).toBe('2 steps · Write(brief.md)');
  });

  it('says how many failed', () => {
    expect(foldSummary([
      { t: 0, kind: 'tool', text: '⏺ Bash(pnpm build)' },
      { t: 1, kind: 'error', text: '  ⎿  Declined' },
    ])).toBe('1 step · 1 failed · Bash(pnpm build)');
  });

  it('counts lines when there is no tool call among them, and clips a long step', () => {
    expect(foldSummary([{ t: 0, kind: 'system', text: `✻ ${'x'.repeat(120)}` }])).toBe(`1 line · ${'x'.repeat(89)}…`);
  });

  it("reads as the latest line when there's no step among them", () => {
    expect(foldSummary([{ t: 0, kind: 'output', text: '  ⎿  Your question is on your screen' }, { t: 1, kind: 'output', text: '' }])).toBe('2 lines · Your question is on your screen');
  });
});

describe('termBlocks', () => {
  const line = (kind: TermLine['kind'], text: string): TermLine => ({ t: 0, kind, text });

  it('reads a session the way its panel does: what it said in view, what it did folded between', () => {
    expect(termBlocks([
      line('manager', '▶ Captain: save items for later'),
      line('tool', '⏺ Read(cart.ts)'),
      line('output', '  ⎿ 40 lines'),
      line('text', '⏺ **Done.** Here:'),
      line('text', '  - one'),
      line('manager', '❓ Asked the captain: which layout?'),
    ])).toEqual([
      { kind: 'sent', text: '▶ Captain: save items for later' },
      { kind: 'fold', text: '1 step · Read(cart.ts)', failed: false },
      { kind: 'reply', text: 'Done. Here:\n• one' },
      { kind: 'notice', text: '❓ Asked the captain: which layout?' },
    ]);
  });

  it('marks a fold failed when a step in it did, and shows a reply line cut off by a fold as a plain line, as the panel does', () => {
    expect(termBlocks([
      line('text', '⏺ First'),
      line('tool', '⏺ Bash(test)'),
      line('error', 'boom'),
      line('text', '  carried on'),
    ])).toEqual([
      { kind: 'reply', text: 'First' },
      { kind: 'fold', text: '1 step · 1 failed · Bash(test)', failed: true },
      { kind: 'line', text: '  carried on' },
    ]);
  });

  it('leaves out blank lines between blocks', () => {
    expect(termBlocks([line('text', '⏺ Hi'), line('system', ''), line('manager', '▶ Captain: yo')])).toEqual([
      { kind: 'reply', text: 'Hi' },
      { kind: 'sent', text: '▶ Captain: yo' },
    ]);
  });
});
