import { describe, expect, it } from 'vitest';
import type { LedgerEvent } from '../../shared/ledger';
import { backfillWho, digestEntry, lastDigest, transcriptSpan } from './sessionDigest';

let n = 0;
const line = (type: string, content: unknown, minute = 0) => JSON.stringify({ type, uuid: `u${++n}`, timestamp: `2026-10-08T12:${String(minute).padStart(2, '0')}:00.000Z`, message: { role: type, content } });
const call = (id: string, command: string, description = 'x') => ({ type: 'tool_use', id, name: 'Bash', input: { command, description } });
const error = (id: string, text: string) => ({ type: 'tool_result', tool_use_id: id, is_error: true, content: text });
const ok = (id: string) => ({ type: 'tool_result', tool_use_id: id, content: 'fine' });

const transcript = () => {
  n = 0;
  return [
    line('user', 'Please resolve GitHub issue #12 in o/r', 0),
    line('assistant', [call('t1', 'grep -r x --include=*.ts'), call('t2', 'rm -rf /tmp/x'), call('t3', 'npm test')], 1),
    line('user', [error('t1', 'zsh: no matches found: --include=*.ts'), error('t2', 'Error: hook error: blocked by dcg: rm -rf on root or home paths'), ok('t3')], 2),
    line('assistant', [call('t4', 'grep -r x --include=*.ts', 'try again'), call('t5', 'npm test', 'after the edit')], 3),
    line('user', 'continue', 4),
    line('user', 'can you make the doors quieter, they’re much too loud at the moment', 5),
    line('user', 'This session is being continued from a previous conversation', 6),
    'not json',
    line('user', '[QA officer Ens. B] QA failed o/r#12', 9),
  ].join('\n');
};

describe('transcriptSpan', () => {
  it('counts calls, failures, refusals, failed calls run again (not ones that worked), the captain’s messages and nudges', () => {
    expect(transcriptSpan(transcript())).toEqual({
      afterUuid: undefined,
      toUuid: 'u8',
      from: '2026-10-08T12:00:00.000Z',
      to: '2026-10-08T12:09:00.000Z',
      facts: { minutes: 9, turns: 2, toolCalls: 5, failedCalls: 2, refusedCalls: 1, repeatedCalls: 1, wastedCalls: 3, captainMessages: 2, nudges: 1, officeMessages: 2, compactions: 1 },
    });
  });

  it('starts after the last digest’s line, and finds nothing new at the end', () => {
    const t = transcript();
    expect(transcriptSpan(t, 'u5')?.facts).toMatchObject({ toolCalls: 0, captainMessages: 1, nudges: 0, compactions: 1, officeMessages: 1 });
    expect(transcriptSpan(t, 'u8')).toBeUndefined();
  });
});

describe('digestEntry', () => {
  const agent = { id: 'a1', name: 'Ens. A', task: 'issue' as const, sessionId: 's1', costUsd: 1.25 };
  const base = { projectId: 'p', at: 1 };

  it('costs the span from the session’s running total, less what the last digest counted', () => {
    const span = transcriptSpan(transcript())!;
    const ledger: LedgerEvent[] = [
      { ...base, seq: 1, ...digestEntry({ ...span, toUuid: 'u3' }, { ...agent, costUsd: 0.5 }, [], []) },
      { ...base, seq: 2, kind: 'qa-verdict', repo: 'o/r', pr: 12, verdict: 'fail', reviewer: 'B', checks: { pass: 0, fail: 1, skip: 0 }, failedRounds: 1 },
      { ...base, seq: 3, kind: 'conflicts', repo: 'o/r', pr: 12, resolved: 'agent' },
      { ...base, seq: 4, kind: 'conflicts', repo: 'o/r', pr: 99, resolved: 'agent' },
    ];
    expect(lastDigest(ledger, 's1')).toEqual({ toUuid: 'u3', sessionCostUsd: 0.5 });
    const entry = digestEntry(span, agent, [{ repo: 'o/r', pr: 12 }], ledger, 'A goal');
    expect(entry).toMatchObject({ key: 's1:u8', sessionCostUsd: 1.25, goal: 'A goal', facts: { costUsd: 0.75, qaFails: 1, conflicts: 1, wastedCalls: 3 } });
  });
});

describe('backfillWho', () => {
  it('reads the agent’s kind, project, reviewed PR and cost from a transcript on disk', () => {
    const qa = [JSON.stringify({ type: 'user', message: { content: 'Please QA pull request #142 in jonhilt/focus: LCARS' } }), '{"type":"cost-state","totalCostUSD":0.5}', '{"type":"cost-state","totalCostUSD":1.25}'].join('\n');
    expect(backfillWho({ name: 'qa-lead-proj-bd529cc4d2-b6a0b8__7e34ab5f', kind: 'qa' }, qa)).toEqual({ task: 'review', projectId: 'proj_bd529cc4d2', prs: [{ repo: 'jonhilt/focus', pr: 142 }], costUsd: 1.25 });
    expect(backfillWho({ name: 'agent-08add1d6e7__fd3a8c8f', kind: 'agent' }, '')).toEqual({ task: 'issue', projectId: '', prs: [], costUsd: undefined });
  });
});
