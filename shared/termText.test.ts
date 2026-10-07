import { describe, expect, it } from 'vitest';
import { plainMarkdown, plainTermLine, replyPart } from './termText';

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

describe('plainTermLine', () => {
  it('keeps the reply marker and indent, and leaves other lines as they came', () => {
    expect(plainTermLine({ t: 0, kind: 'text', text: '⏺ **Done**' })).toBe('⏺ Done');
    expect(plainTermLine({ t: 0, kind: 'text', text: '  - `a`' })).toBe('  • a');
    expect(plainTermLine({ t: 0, kind: 'output', text: '  ⎿  **raw**' })).toBe('  ⎿  **raw**');
  });
});
