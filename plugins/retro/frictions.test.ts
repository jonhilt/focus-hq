import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../plugin-api/shared';
import { batchesOf, checkFrictions, extractionInput, parseRead, readerPrompt, signatureOf } from './frictions';

let n = 0;
const line = (type: string, content: unknown, minute = 0) => JSON.stringify({ type, uuid: `u${++n}`, timestamp: `2026-10-08T12:${String(minute).padStart(2, '0')}:00.000Z`, message: { content } });

const transcript = () => {
  n = 0;
  return [
    line('user', 'Please resolve GitHub issue #12 in o/r', 0),
    line('assistant', [{ type: 'text', text: 'Shall I ship it?' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls *.md', description: 'list' } }], 1),
    line('user', [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'zsh: no matches found: *.md\nmore detail' }], 2),
    line('user', 'go', 3),
    line('assistant', [{ type: 'text', text: 'Lesson: always quote globs in zsh.' }], 4),
  ].join('\n');
};

describe('extractionInput', () => {
  it('shows who said what, failed calls with their errors, the agent’s own words and the ledger', () => {
    const qa: LedgerEvent = { projectId: 'p', seq: 3, at: 1, kind: 'qa-verdict', repo: 'o/r', pr: 12, verdict: 'fail', reviewer: 'B', checks: { pass: 0, fail: 1, skip: 0 }, failedRounds: 1 };
    expect(extractionInput(transcript(), undefined, [qa])).toBe(
      [
        '[12:00] OFFICE: Please resolve GitHub issue #12 in o/r',
        '[12:01] AGENT: Shall I ship it?',
        '[12:02] FAILED Bash: ls *.md → zsh: no matches found: *.md',
        '[12:03] CAPTAIN: go\n  (the agent had just said: “Shall I ship it?”)',
        '[12:04] AGENT: Lesson: always quote globs in zsh.',
        '',
        'LEDGER qa-verdict: {"repo":"o/r","pr":12,"verdict":"fail","reviewer":"B","checks":{"pass":0,"fail":1,"skip":0},"failedRounds":1}',
      ].join('\n'),
    );
  });

  it('shows a call’s input as it came when it isn’t an object', () => {
    n = 0;
    const odd = [
      line('assistant', [{ type: 'tool_use', id: 't1', name: 'Bash', input: 'ls' }, { type: 'tool_use', id: 't2', name: 'Read' }]),
      line('user', [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'bad input' }, { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'no path' }]),
    ].join('\n');
    expect(extractionInput(odd, undefined, [])).toBe('[12:00] FAILED Bash: "ls" → bad input\n[12:00] FAILED Read: {} → no path');
  });

  it('starts after the given line', () => {
    expect(extractionInput(transcript(), 'u3', [])).toBe('[12:03] CAPTAIN: go\n  (the agent had just said: “Shall I ship it?”)\n[12:04] AGENT: Lesson: always quote globs in zsh.');
  });

  it('drops the agent’s own words first when the span runs long', () => {
    n = 0;
    const long = [...Array.from({ length: 200 }, (_, i) => line('assistant', [{ type: 'text', text: `${i} ${'x'.repeat(390)}` }])), line('user', 'please fix the header')].join('\n');
    const input = extractionInput(long, undefined, []);
    expect(input.length).toBeLessThanOrEqual(40_000);
    expect(input.endsWith('CAPTAIN: please fix the header\n  (the agent had just said: “199 ' + 'x'.repeat(296) + ' …[+94]”)')).toBe(true);
    expect(input).not.toContain('AGENT: 0 ');
  });
});

describe('checking what the reader found', () => {
  const input = extractionInput(transcript(), undefined, []);

  it('keeps what’s quoted word for word, spacing aside', () => {
    expect(checkFrictions([{ kind: 'shell', signature: 'Zsh glob: no matches!', quote: 'zsh: no   matches found: *.md' }, { kind: 'captain-nudge', signature: 'nudge', quote: 'CAPTAIN: go' }], input)).toEqual([
      { kind: 'shell', signature: 'zsh glob no matches', quote: 'zsh: no matches found: *.md' },
      { kind: 'captain-nudge', signature: 'nudge', quote: 'CAPTAIN: go' },
    ]);
  });

  it('drops what isn’t in the text, an unknown kind and an empty signature', () => {
    expect(checkFrictions([{ kind: 'shell', signature: 'made up', quote: 'the build was slow' }, { kind: 'vibes', signature: 'x', quote: 'ls *.md' }, { kind: 'shell', signature: '!!!', quote: 'ls *.md' }], input)).toEqual([]);
    expect(checkFrictions(undefined, input)).toEqual([]);
  });

  it('keeps a quote with double quotes in it, from what the agent had just said', () => {
    n = 0;
    const said = [line('assistant', [{ type: 'text', text: 'Run "npm test" now?' }]), line('user', 'yes, and quote globs')].join('\n');
    expect(checkFrictions([{ kind: 'captain-nudge', signature: 'go ahead', quote: 'Run "npm test" now?' }], extractionInput(said, undefined, []))).toHaveLength(1);
  });

  it('checks each span’s frictions against that span’s own text', () => {
    const batch = [{ label: 'S1', input: 'FAILED Bash: ls *.md → zsh: no matches found: *.md' }, { label: 'S2', input: 'CAPTAIN: go' }];
    const zsh = { kind: 'shell', signature: 'zsh glob', quote: 'zsh: no matches found: *.md' };
    const found = parseRead({ spans: [{ id: 'S1', frictions: [zsh] }, { id: 'S2', frictions: [zsh] }, { id: 'S9', frictions: [] }] }, batch);
    expect(found.get('S1')).toHaveLength(1);
    expect(found.get('S2')).toEqual([]);
    expect([...found.keys()]).toEqual(['S1', 'S2']);
  });

  it('passes over an answer, a span or a friction that isn’t an object', () => {
    const batch = [{ label: 'S1', input: 'FAILED Bash: ls *.md → zsh: no matches found: *.md' }];
    const zsh = { kind: 'shell', signature: 'zsh glob', quote: 'zsh: no matches found: *.md' };
    expect(parseRead({ spans: [null, 'S1', ['S1'], { id: 'S1', frictions: [null, 'zsh', [zsh], zsh] }] }, batch).get('S1')).toEqual([{ ...zsh, signature: 'zsh glob' }]);
    expect(parseRead(['spans'], batch).get('S1')).toEqual([]);
    expect(parseRead('S1', batch).get('S1')).toEqual([]);
  });

  it('turns a signature into a few lowercase words', () => {
    expect(signatureOf('  DCG blocks `ls` on /tmp, again and again and again and again ')).toBe('dcg blocks ls on tmp again and again');
  });
});

describe('the reader’s batches and prompt', () => {
  it('fills each batch up to its size, and never leaves a big span out', () => {
    const items = [{ input: 'a'.repeat(6) }, { input: 'b'.repeat(4) }, { input: 'c'.repeat(12) }, { input: 'd' }];
    expect(batchesOf(items, 10).map((b) => b.map((i) => i.input[0]).join(''))).toEqual(['ab', 'c', 'd']);
  });

  it('labels each span and hands over the signatures to reuse', () => {
    const prompt = readerPrompt([{ label: 'S1', input: 'one' }, { label: 'S2', input: 'two' }], ['demo-env: demo port in use']);
    expect(prompt).toContain('<span id="S1">\none\n</span>');
    expect(prompt).toContain('- demo-env: demo port in use');
    expect(readerPrompt([{ label: 'S1', input: 'one' }], [])).not.toContain('Signatures already in use');
  });

  it('stops a span at its last line', () => {
    expect(extractionInput(transcript(), undefined, [], 'u3')).toBe('[12:00] OFFICE: Please resolve GitHub issue #12 in o/r\n[12:01] AGENT: Shall I ship it?\n[12:02] FAILED Bash: ls *.md → zsh: no matches found: *.md');
  });
});
