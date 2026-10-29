import type { ConversationSummary } from 'agent-host';
import { describe, expect, it } from 'vitest';
import { isSdkMessage, joining, outcome, reaction, runsOnHost } from './hostRunnerRules';
import { STOPPED_BY_CAPTAIN } from './types';

const conv = (id: string, status: string, agentSessionId?: string): ConversationSummary => ({ id, agent: 'claude', labels: {}, status, ...(agentSessionId && { agentSessionId }) });

describe('runsOnHost', () => {
  it("runs developers' and QA's local sessions on the host, and no one else's", () => {
    for (const task of ['issue', 'fix', 'conflicts', 'brief', 'review'] as const) expect(runsOnHost(task, false)).toBe(true);
    expect(runsOnHost('lead', false)).toBe(false);
    expect(runsOnHost('issue', true)).toBe(false);
    expect(runsOnHost(undefined, false)).toBe(false);
  });
});

describe('joining', () => {
  it('starts a new conversation for a fresh session, ending the agent’s old ones', () => {
    expect(joining([conv('a', 'idle', 's1'), conv('b', 'ended', 's0')], undefined)).toEqual({ kind: 'start', stop: ['a'] });
  });

  it("sends into the conversation carrying the session on, or watches the turn the host is already carrying", () => {
    expect(joining([conv('a', 'idle', 's1')], 's1')).toEqual({ kind: 'send', id: 'a' });
    for (const status of ['running', 'waiting', 'resuming', 'held', 'interrupted']) expect(joining([conv('a', status, 's1')], 's1')).toEqual({ kind: 'attach', id: 'a' });
  });

  it('carries on a session that predates the host in a new conversation', () => {
    expect(joining([], 'old-session')).toEqual({ kind: 'start', resumes: 'old-session', stop: [] });
    expect(joining([conv('a', 'ended', 'old-session')], 'old-session')).toEqual({ kind: 'start', resumes: 'old-session', stop: [] });
  });
});

describe('outcome', () => {
  const ended = (o: 'completed' | 'interrupted' | 'failed', error?: string) => ({ _tag: 'TurnEnded' as const, outcome: o, source: { _tag: 'Main' as const }, ...(error && { error }) });
  it('comes to the last result, a stop, or the failure', () => {
    expect(outcome(ended('completed'), { text: 'did it', isError: false, queued: 0 })).toEqual({ ok: true, summary: 'did it', structured: undefined, started: true });
    expect(outcome(ended('interrupted'), undefined)).toMatchObject({ ok: false, aborted: true, error: STOPPED_BY_CAPTAIN });
    expect(outcome(ended('failed', 'Claude Code exited.'), undefined)).toMatchObject({ ok: false, error: 'Claude Code exited.' });
  });
});

describe('isSdkMessage', () => {
  it("tells Claude Code's own messages from the host's own notes", () => {
    expect(isSdkMessage({ type: 'assistant', uuid: 'u', session_id: 's' })).toBe(true);
    expect(isSdkMessage({ pushed: 'text' })).toBe(false);
    expect(isSdkMessage(undefined)).toBe(false);
  });
});

describe('reaction', () => {
  const main = { _tag: 'Main' as const };
  it('puts a raised hand to the manager, and stops waiting once anyone answers', () => {
    expect(reaction({ _tag: 'PermissionRequested', requestId: 'r', tool: 'Bash', input: {}, summary: 'Bash(curl x)', source: main }, undefined)).toEqual({ kind: 'ask', requestId: 'r', tool: 'Bash', summary: 'Bash(curl x)' });
    expect(reaction({ _tag: 'PermissionAnswered', requestId: 'r', answer: { _tag: 'AllowOnce' } }, undefined)).toEqual({ kind: 'resolved', requestId: 'r' });
    expect(reaction({ _tag: 'QuestionAnswered', requestId: 'q', answer: { _tag: 'Answers', answers: {} } }, undefined)).toEqual({ kind: 'resolved', requestId: 'q' });
  });

  it('reports how full the context is, when the usage says', () => {
    expect(reaction({ _tag: 'Usage', context: { percent: 40, tokens: 80_000, max: 200_000 }, source: main }, undefined)).toEqual({ kind: 'context', context: { percent: 40, tokens: 80_000, max: 200_000 } });
    expect(reaction({ _tag: 'Usage', costUsd: 0.1, source: main }, undefined)).toEqual({ kind: 'none' });
  });

  it('says when the usage limit pauses the session and when it carries on, and when it carries on after a restart', () => {
    const held = reaction({ _tag: 'Held', until: Date.UTC(2026, 9, 28, 15, 0) }, undefined);
    expect(held).toMatchObject({ kind: 'say', lines: [{ kind: 'error', text: expect.stringContaining('paused until it resets') }], activity: expect.stringContaining('Paused for the usage limit') });
    expect(reaction({ _tag: 'Released', note: 'n' }, undefined)).toEqual({ kind: 'say', lines: [{ kind: 'system', text: '✻ The usage limit has reset: carrying on' }] });
    expect(reaction({ _tag: 'ResumedAfterRestart', note: 'n' }, undefined)).toEqual({ kind: 'say', lines: [{ kind: 'system', text: '✻ Carrying on where Focus stopped' }] });
  });

  it('ends a turn that asked for a structured answer once the answer is in, unless a message sent meanwhile is still unread', () => {
    const answer = { _tag: 'StructuredAnswer' as const, value: { verdict: 'pass' }, source: main };
    expect(reaction(answer, { text: 'QA passed', isError: false, queued: 0 }, true)).toEqual({ kind: 'answered', outcome: { ok: true, summary: 'QA passed', structured: { verdict: 'pass' }, started: true } });
    expect(reaction(answer, { text: 'QA passed', isError: false, queued: 1 }, true)).toEqual({ kind: 'none' });
    expect(reaction(answer, { text: 'QA passed', isError: false, queued: 0 }, false)).toEqual({ kind: 'none' });
  });

  it('ends the turn when the host’s turn or the conversation ends', () => {
    const result = { text: 'did it', isError: false, queued: 0 };
    expect(reaction({ _tag: 'TurnEnded', outcome: 'completed', source: main }, result)).toEqual({ kind: 'end', outcome: { ok: true, summary: 'did it', structured: undefined, started: true } });
    expect(reaction({ _tag: 'ConversationEnded' }, result)).toEqual({ kind: 'end', outcome: { ok: false, summary: 'did it', error: 'The conversation ended', aborted: true, started: true } });
    expect(reaction({ _tag: 'MessageSent', text: 'hi' }, result)).toEqual({ kind: 'none' });
  });
});
