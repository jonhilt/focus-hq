import { describe, expect, it } from 'vitest';
import { retroAfterRestart, freshRetro } from '../store';
import { digestSession, errorShape, frequentErrors, messageFrom, parseRetro, renderDigest, renderIndex, type SessionDigest } from './retro';

const line = (type: string, content: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ type, timestamp: '2026-10-07T12:00:00.000Z', message: { role: type, content }, ...extra });
const meta = { name: 'lead-proj-x__abcd1234', kind: 'lead' as const, sessionId: 'abcd1234-ffff' };

describe('messageFrom', () => {
  it('knows the office’s and QA’s messages by how they open', () => {
    expect(messageFrom('[Office] Slice 1 has landed')).toBe('office');
    expect(messageFrom('[QA officer Ensign Halloran] QA failed jonhilt/focus#154')).toBe('qa');
    expect(messageFrom('Please QA pull request #12 in demo/shop')).toBe('office');
    expect(messageFrom('This session is being continued from a previous conversation')).toBe('compacted');
  });

  it('leaves out the harness’s own messages, and takes the rest as the captain’s', () => {
    expect(messageFrom('<system-reminder>…</system-reminder>')).toBeNull();
    expect(messageFrom('<task-notification>done</task-notification>')).toBeNull();
    expect(messageFrom('can we make the doors quieter?')).toBe('captain');
  });
});

describe('digestSession', () => {
  it('keeps who said what, what the agent said before the captain spoke, QA verdicts and tool errors', () => {
    const jsonl = [
      line('user', 'Your workspace, with every repo of the project checked out side by side'),
      line('assistant', [{ type: 'text', text: 'Shall I ship it?' }, { type: 'tool_use', name: 'Bash', input: {} }]),
      line('user', [{ type: 'tool_result', is_error: true, content: 'no matches found: --include=*.ts\nmore' }]),
      line('user', 'ship it'),
      line('user', '<system-reminder>ignore me</system-reminder>'),
      line('user', 'hidden', { isMeta: true }),
      line('assistant', [{ type: 'tool_use', name: 'StructuredOutput', input: { verdict: 'fail', summary: 'README table broken' } }]),
      'not json',
      JSON.stringify({ type: 'ai-title', aiTitle: 'Ship the thing' }),
    ].join('\n');
    const d = digestSession(jsonl, meta);
    expect(d).toMatchObject({ title: 'Ship the thing', turns: 2, toolCalls: 2, errors: ['no matches found: --include=*.ts'], verdicts: [{ verdict: 'fail', summary: 'README table broken' }] });
    expect(d.messages.map((m) => m.from)).toEqual(['office', 'captain']);
    expect(d.messages[1]).toMatchObject({ text: 'ship it', before: 'Shall I ship it?' });
    expect(renderDigest(d)).toContain('CAPTAIN: ship it\n  (the agent had just said: "Shall I ship it?")');
  });

  it('clips long messages, keeping the captain’s longest', () => {
    const d = digestSession([line('user', `[Office] ${'x'.repeat(2000)}`), line('user', 'y'.repeat(2500))].join('\n'), meta);
    expect(d.messages[0].text).toMatch(/…\[\+\d+\]$/);
    expect(d.messages[0].text.length).toBeLessThan(800);
    expect(d.messages[1].text.length).toBeGreaterThan(2000);
  });
});

describe('frequentErrors', () => {
  const digest = (name: string, errors: string[]): SessionDigest => ({ ...meta, name, errors, messages: [], verdicts: [], turns: 0, toolCalls: 0 });

  it('blurs numbers, paths and quoted bits so the same failure counts once', () => {
    expect(errorShape('Error: listen EADDRINUSE :::4591 at /tmp/a/b.ts')).toBe(errorShape('Error: listen EADDRINUSE :::5310 at /var/x.ts'));
  });

  it('lists only errors seen in more than one session, most widespread first', () => {
    const errors = frequentErrors([
      digest('a', ['ERR_CONNECTION_REFUSED at http://localhost:4591/', 'only here']),
      digest('b', ['ERR_CONNECTION_REFUSED at http://localhost:5310/', 'zsh: no matches found: --include=*.ts']),
      digest('c', ['ERR_CONNECTION_REFUSED at http://localhost:4600/', 'zsh: no matches found: --include=*.cs']),
    ]);
    expect(errors.map((e) => e.sessions)).toEqual([['a', 'b', 'c'], ['b', 'c']]);
  });

  it('shows them in the index', () => {
    const index = renderIndex([digest('a', ['zsh: no matches found: *.ts']), digest('b', ['zsh: no matches found: *.cs'])], 14);
    expect(index).toContain('2 sessions, 2×');
    expect(index).toContain('| a | lead |');
  });
});

describe('parseRetro', () => {
  const sessions = new Set(['lead-a__1', 'qa-b__2']);
  const proposal = (evidence: unknown[], kind = 'check') => ({ title: 'Do it', problem: 'p', evidence, fix: 'f', kind, measure: 'm' });

  it('keeps a proposal resting on two moments in known sessions', () => {
    const out = parseRetro({ summary: 's', proposals: [proposal([{ session: 'sessions/lead-a__1.md', at: '12:00', quote: 'go' }, { session: 'qa-b__2', quote: 'pass' }])], wentWell: ['x'], watch: [] }, sessions);
    expect(out?.proposals[0].evidence.map((e) => e.session)).toEqual(['lead-a__1', 'qa-b__2']);
    expect(out?.wentWell).toEqual(['x']);
  });

  it('drops a proposal citing fewer than two real moments', () => {
    const out = parseRetro({ summary: 's', proposals: [proposal([{ session: 'lead-a__1', quote: 'go' }, { session: 'made-up__9', quote: 'x' }]), proposal([{ session: 'ledger', quote: '15 unpassed merges' }, { session: 'qa-b__2', quote: '' }])] }, sessions);
    expect(out?.proposals).toEqual([]);
  });

  it('falls back to a pointer for an unknown kind, and gives up on nothing at all', () => {
    expect(parseRetro({ summary: 's', proposals: [proposal([{ session: 'ledger', quote: 'a' }, { session: 'qa-b__2', quote: 'b' }], 'essay')] }, sessions)?.proposals[0].kind).toBe('pointer');
    expect(parseRetro(undefined, sessions)).toBeUndefined();
    expect(parseRetro({ proposals: [] }, sessions)).toBeUndefined();
  });
});

describe('retroAfterRestart', () => {
  it('ends a retro that was under way when Focus shut down', () => {
    expect(retroAfterRestart({ ...freshRetro(), status: 'thinking' })).toMatchObject({ status: 'failed', activity: 'Interrupted' });
    expect(retroAfterRestart({ ...freshRetro(), status: 'done' }).status).toBe('done');
  });
});
