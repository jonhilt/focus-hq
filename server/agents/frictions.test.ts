import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../shared/ledger';
import { extractionInput, parseExtraction, signatureOf } from './frictions';

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
        '[12:03] CAPTAIN: go\n  (the agent had just said: "Shall I ship it?")',
        '[12:04] AGENT: Lesson: always quote globs in zsh.',
        '',
        'LEDGER qa-verdict: {"repo":"o/r","pr":12,"verdict":"fail","reviewer":"B","checks":{"pass":0,"fail":1,"skip":0},"failedRounds":1}',
      ].join('\n'),
    );
  });

  it('starts after the given line', () => {
    expect(extractionInput(transcript(), 'u3', [])).toBe('[12:03] CAPTAIN: go\n  (the agent had just said: "Shall I ship it?")\n[12:04] AGENT: Lesson: always quote globs in zsh.');
  });

  it('drops the agent’s own words first when the span runs long', () => {
    n = 0;
    const long = [...Array.from({ length: 200 }, (_, i) => line('assistant', [{ type: 'text', text: `${i} ${'x'.repeat(390)}` }])), line('user', 'please fix the header')].join('\n');
    const input = extractionInput(long, undefined, []);
    expect(input.length).toBeLessThanOrEqual(40_000);
    expect(input.endsWith('CAPTAIN: please fix the header\n  (the agent had just said: "199 ' + 'x'.repeat(296) + ' …[+94]")')).toBe(true);
    expect(input).not.toContain('AGENT: 0 ');
  });
});

describe('parseExtraction', () => {
  const input = extractionInput(transcript(), undefined, []);

  it('keeps what’s quoted word for word, spacing aside', () => {
    const out = parseExtraction(
      {
        frictions: [
          { kind: 'shell', signature: 'Zsh glob: no matches!', quote: 'zsh: no   matches found: *.md' },
          { kind: 'captain-nudge', signature: 'nudge', quote: 'CAPTAIN: go' },
        ],
        rework: [{ what: 'quoted the glob', quote: 'ls *.md' }],
        lesson: 'always quote globs in zsh',
      },
      input,
    );
    expect(out).toEqual({
      frictions: [
        { kind: 'shell', signature: 'zsh glob no matches', quote: 'zsh: no matches found: *.md' },
        { kind: 'captain-nudge', signature: 'nudge', quote: 'CAPTAIN: go' },
      ],
      rework: [{ what: 'quoted the glob', quote: 'ls *.md' }],
      lesson: 'always quote globs in zsh',
    });
  });

  it('drops what isn’t in the text, an unknown kind, an empty signature, and a lesson nobody said', () => {
    const out = parseExtraction(
      {
        frictions: [
          { kind: 'shell', signature: 'made up', quote: 'the build was slow' },
          { kind: 'vibes', signature: 'x', quote: 'ls *.md' },
          { kind: 'shell', signature: '!!!', quote: 'ls *.md' },
        ],
        rework: [{ what: '', quote: 'ls *.md' }],
        lesson: 'Always write tests first.',
      },
      input,
    );
    expect(out).toEqual({ frictions: [], rework: [] });
    expect(parseExtraction(undefined, input)).toEqual({ frictions: [], rework: [] });
  });

  it('turns a signature into a few lowercase words', () => {
    expect(signatureOf('  DCG blocks `rm -rf` on /tmp, again and again and again ')).toBe('dcg blocks rm -rf on tmp again and');
  });
});
