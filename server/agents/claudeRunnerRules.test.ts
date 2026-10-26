import { describe, expect, it } from 'vitest';
import { withResult, type SoFar } from './claudeRunner';
import { allowedWithoutAsking, answerEnds, endedOutcome, failedOutcome, holdsInput, runningInBackground, showsHeard } from './claudeRunnerRules';
import { CLOUD_UNAVAILABLE } from './cloudRules';
import { LIMIT_REACHED, STOPPED_BY_CAPTAIN } from './types';

describe('holdsInput', () => {
  it('keeps listening while anything runs in the background: a workflow, a subagent, a command or a monitor', () => {
    expect(holdsInput(['local_workflow'])).toBe(true);
    expect(holdsInput(['local_agent'])).toBe(true);
    expect(holdsInput(['local_bash'])).toBe(true);
  });

  it('doesn’t once nothing does', () => {
    expect(holdsInput([])).toBe(false);
  });
});

describe('answerEnds', () => {
  const answer = { isError: false, queued: 0, structured: { verdict: 'pass' } };

  it('ends a session asked for an answer once its turn gives it, with nothing waiting', () => {
    expect(answerEnds(true, answer)).toBe(true);
  });

  it('doesn’t without the answer, with a message waiting, on an error, or when no answer was asked for', () => {
    expect(answerEnds(true, { ...answer, structured: undefined })).toBe(false);
    expect(answerEnds(true, { ...answer, queued: 1 })).toBe(false);
    expect(answerEnds(true, { ...answer, isError: true })).toBe(false);
    expect(answerEnds(false, answer)).toBe(false);
  });
});

describe('runningInBackground', () => {
  it('is what Claude Code listed', () => {
    expect(runningInBackground(['local_bash'], 0)).toEqual(['local_bash']);
    expect(runningInBackground(['local_workflow'], 1)).toEqual(['local_workflow']);
  });

  it('counts a workflow Ops has seen start and not end, even when the list leaves it out', () => {
    expect(runningInBackground([], 1)).toEqual(['local_workflow']);
    expect(holdsInput(runningInBackground([], 2))).toBe(true);
  });
});

describe('showsHeard', () => {
  // c7: the background list, a task's end or progress, come whatever Claude Code has read
  it('takes only what Claude Code says in a turn as hearing a message, not what it reports of its background', () => {
    expect(showsHeard({ type: 'assistant' })).toBe(true);
    expect(['system', 'result', 'user', 'stream_event'].map((type) => showsHeard({ type }))).toEqual([false, false, false, false]);
  });
});

describe('allowedWithoutAsking', () => {
  it('lets ask mode use its plain tools and the browser, and nothing else', () => {
    expect(allowedWithoutAsking('ask', 'Edit')).toBe(true);
    expect(allowedWithoutAsking('ask', 'mcp__browser__open')).toBe(true);
    expect(allowedWithoutAsking('ask', 'Bash')).toBe(false);
    expect(allowedWithoutAsking('ask', 'mcp__office__ship')).toBe(false);
  });

  it('asks the classifier in auto mode, and never asks in full', () => {
    expect(allowedWithoutAsking('auto', 'Edit')).toBe(false);
    expect(allowedWithoutAsking('full', 'Bash')).toBe(true);
    expect(allowedWithoutAsking('full', 'mcp__office__ship')).toBe(true);
  });
});

describe('a session’s outcome', () => {
  const fresh: SoFar = { ok: false, summary: '', started: true };
  const answered = withResult(fresh, { text: 'Done', isError: false, queued: 0, structured: { verdict: 'pass' } });
  const calm = { stopping: false, limited: false };
  const failure = { ...calm, aborted: false, cloud: false, stderr: '' };

  it('is its last turn’s result, keeping the structured answer when a later turn gives none', () => {
    const later = withResult(answered, { text: 'And a follow-up', isError: false, queued: 0 });
    expect(endedOutcome(later, calm)).toEqual({ ok: true, summary: 'And a follow-up', structured: { verdict: 'pass' }, started: true });
  });

  it('fails with the turn’s text when the last turn was an error, after one that passed', () => {
    const failed = withResult(answered, { text: 'Prompt is too long', isError: true, queued: 0 });
    expect(endedOutcome(failed, calm)).toMatchObject({ ok: false, summary: 'Prompt is too long', error: 'Prompt is too long' });
  });

  it('is a stop when the captain sent them home, even once the usage limit was reached too', () => {
    expect(endedOutcome(answered, { stopping: true, limited: true })).toEqual({ ok: false, summary: 'Done', error: STOPPED_BY_CAPTAIN, aborted: true, started: true });
  });

  it('is the usage limit when that ended the session', () => {
    expect(endedOutcome(answered, { stopping: false, limited: true })).toEqual({ ok: false, summary: 'Done', error: LIMIT_REACHED, limited: true, started: true });
  });

  it('is the usage limit when Claude Code throws after reaching it, unless the captain stopped them', () => {
    expect(failedOutcome(answered, new Error('aborted'), { ...failure, limited: true, aborted: true })).toMatchObject({ error: LIMIT_REACHED, limited: true });
    expect(failedOutcome(answered, new Error('aborted'), { ...failure, limited: true, stopping: true })).toMatchObject({ error: STOPPED_BY_CAPTAIN, aborted: true });
  });

  it('is a stop when Claude Code throws because the session was aborted', () => {
    expect(failedOutcome(fresh, new Error('Claude Code process aborted'), { ...failure, aborted: true })).toEqual({ ok: false, summary: '', error: STOPPED_BY_CAPTAIN, aborted: true, started: true });
  });

  it('is the cloud being unavailable when the CLI refused to start a cloud session, and only for a cloud session', () => {
    const refusal = { ...failure, stderr: 'Error: --cloud requires an interactive terminal\n' };
    expect(failedOutcome({ ...fresh, started: false }, new Error('exited with code 1'), { ...refusal, cloud: true })).toEqual({ ok: false, summary: '', error: CLOUD_UNAVAILABLE, started: false });
    expect(failedOutcome(fresh, new Error('exited with code 1'), refusal).error).not.toBe(CLOUD_UNAVAILABLE);
  });

  it('is the error, with the last three lines Claude Code wrote, otherwise', () => {
    const stderr = 'one\ntwo\nthree\nfour\n';
    expect(failedOutcome(answered, new Error('exited with code 1'), { ...failure, stderr })).toEqual({ ok: false, summary: 'Done', error: 'exited with code 1 — two three four', started: true });
    expect(failedOutcome(answered, new Error('exited with code 1'), failure).error).toBe('exited with code 1');
  });
});
