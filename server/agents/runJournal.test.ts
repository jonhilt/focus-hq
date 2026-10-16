import { describe, expect, it } from 'vitest';
import { fold, INTERRUPTED_ACTIVITY, journalLine, readJournal, recovery, RESUMED_NOTE, type RunFact, signInMismatch } from './runJournal';

const requested = (turn: string, prompt = 'Fix the flaky test', resumes?: string): RunFact => ({ kind: 'turn-requested', turn, turnKind: 'work', prompt, resumes });
const issue = { task: 'issue' };

describe('fold', () => {
  it('keeps the inbox in order: at the end, in front, and after the turn once it’s released', () => {
    const run = fold([
      { kind: 'queued', text: 'b', at: 'end' },
      { kind: 'queued', text: 'a', at: 'front' },
      { kind: 'queued', text: 'news', at: 'later' },
      { kind: 'queued', text: 'c', at: 'end' },
    ]);
    expect(run).toMatchObject({ inbox: ['a', 'b', 'c'], later: ['news'], seq: 4 });
    expect(fold([{ kind: 'queued', text: 'a', at: 'end' }, { kind: 'queued', text: 'news', at: 'later' }, { kind: 'released' }]).inbox).toEqual(['a', 'news']);
    expect(fold([{ kind: 'queued', text: 'a', at: 'end' }, { kind: 'queued', text: 'news', at: 'later' }, { kind: 'taken' }, { kind: 'queued', text: 'b', at: 'end' }, { kind: 'cleared' }])).toMatchObject({ inbox: [], later: [], owed: [] });
  });

  it('starts from nothing when the agent was sent home, numbering on', () => {
    const run = fold([{ kind: 'queued', text: 'a', at: 'later' }, { kind: 'taken' }, requested('t1'), { kind: 'reset' }]);
    expect(run).toEqual({ inbox: [], later: [], owed: [], seq: 4 });
  });

  it('owes messages taken for a prompt until their turn is requested, and gives them back if it never is', () => {
    const taken = fold([{ kind: 'queued', text: 'Also the docs', at: 'end' }, { kind: 'taken' }]);
    expect(taken).toMatchObject({ inbox: [], owed: ['Also the docs'] });
    expect(fold([{ kind: 'queued', text: 'Also the docs', at: 'end' }, { kind: 'taken' }, requested('t1', 'Also the docs')]).owed).toEqual([]);
    expect(fold([{ kind: 'queued', text: 'Also the docs', at: 'end' }, { kind: 'taken' }, { kind: 'queued', text: 'And tests', at: 'end' }, { kind: 'restored' }])).toMatchObject({
      inbox: ['Also the docs', 'And tests'],
      owed: [],
    });
    // compacting the conversation in between doesn't pay what the next turn is owed
    expect(fold([{ kind: 'queued', text: 'x', at: 'end' }, { kind: 'taken' }, { kind: 'turn-requested', turn: 'c1', turnKind: 'compact', prompt: '/compact' }]).owed).toEqual(['x']);
  });

  it('follows a turn from its request to its end, with its session, its sign-in and what was sent into it', () => {
    const open = fold([
      requested('t1'),
      { kind: 'signed-in', turn: 't1', onKey: false },
      { kind: 'turn-started', turn: 't1', session: 's1', keySource: 'none' },
      { kind: 'queued', text: 'one', at: 'end' },
      { kind: 'taken', turn: 't1' },
      { kind: 'sent', turn: 't1', text: 'two' },
    ]);
    expect(open.open).toEqual({ id: 't1', kind: 'work', prompt: 'Fix the flaky test', onKey: false, session: 's1', keySource: 'none', sent: ['one', 'two'] });
    expect(open.session).toBe('s1');
    const ended = fold([requested('t1'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }]);
    expect(ended.open).toBeUndefined();
    expect(ended.last).toMatchObject({ id: 't1', outcome: { ok: true } });
  });

  it('ignores facts about a turn that isn’t the open one', () => {
    const run = fold([requested('t2'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }, { kind: 'signed-in', turn: 't1', onKey: true }]);
    expect(run.open).toEqual({ id: 't2', kind: 'work', prompt: 'Fix the flaky test' });
  });
});

describe('recovery', () => {
  it('has nothing to do when no turn was in flight', () => {
    expect(recovery(fold([requested('t1'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }]), issue, false)).toEqual({ kind: 'none' });
  });

  it('tells a turn Claude Code had that it was cut off, with what was sent into it in case it never arrived', () => {
    const run = fold([requested('t1'), { kind: 'turn-started', turn: 't1', session: 's1' }, { kind: 'sent', turn: 't1', text: 'Also the docs' }]);
    const next = recovery(run, issue, false);
    expect(next).toMatchObject({ kind: 'resume', turn: 't1', session: 's1' });
    expect(next.kind === 'resume' && next.prompt).toBe(`${RESUMED_NOTE}\n\nThese messages were sent to you during that turn, in case they didn't reach you before it was cut off:\n\nAlso the docs`);
    expect(recovery(fold([requested('t1'), { kind: 'turn-started', turn: 't1', session: 's1' }]), issue, false)).toMatchObject({ prompt: RESUMED_NOTE });
  });

  it('asks a turn Claude Code never got again, in the conversation it was going back to', () => {
    expect(recovery(fold([requested('t2', 'Also the docs', 's1')]), { task: 'lead' }, false)).toEqual({ kind: 'resume', turn: 't2', prompt: 'Also the docs', session: 's1' });
  });

  it('waits for the captain on the API key, for QA, a cloud agent, a compaction, a sign-in stopped, or no conversation', () => {
    const run = fold([requested('t1'), { kind: 'turn-started', turn: 't1', session: 's1' }]);
    expect(recovery(run, issue, true)).toMatchObject({ kind: 'wait', why: expect.stringContaining('API key') });
    expect(recovery(run, { task: 'review' }, false)).toEqual({ kind: 'wait', turn: 't1', why: INTERRUPTED_ACTIVITY });
    expect(recovery(run, { ...issue, cloud: true }, false)).toMatchObject({ kind: 'wait', why: INTERRUPTED_ACTIVITY });
    expect(recovery(fold([requested('t1')]), { task: 'issue' }, false)).toMatchObject({ kind: 'wait', why: INTERRUPTED_ACTIVITY });
    expect(recovery(fold([{ kind: 'turn-requested', turn: 'c1', turnKind: 'compact', prompt: '/compact', resumes: 's1' }]), issue, false)).toMatchObject({ kind: 'wait', why: expect.stringContaining('compacting') });
    expect(recovery(fold([requested('t1', 'Go', 's1'), { kind: 'sign-in-mismatch', turn: 't1', observed: 'ANTHROPIC_API_KEY' }]), issue, false)).toMatchObject({ kind: 'wait', why: expect.stringContaining('API key') });
  });

  it('leaves a turn the captain stopped stopped', () => {
    expect(recovery(fold([requested('t1', 'Go', 's1'), { kind: 'stop-requested', turn: 't1' }]), issue, false)).toMatchObject({ kind: 'wait', why: expect.stringContaining('Stopped by the captain') });
  });

  it('never carries a turn that was starting a new conversation on in an old one', () => {
    // the lead's fresh session after Claude Code lost theirs: the agent's saved session id may still be the old one
    expect(recovery(fold([requested('t1', 'You’re carrying on in a new conversation')]), { task: 'lead' }, false)).toMatchObject({ kind: 'wait' });
  });
});

describe('signInMismatch', () => {
  it('is a key that costs when the office meant your plan, and nothing else', () => {
    expect(signInMismatch(false, 'ANTHROPIC_API_KEY')).toBe(true);
    expect(signInMismatch(false, 'apiKeyHelper')).toBe(true);
    expect(signInMismatch(false, 'none')).toBe(false);
    expect(signInMismatch(false, '/login managed key')).toBe(false);
    expect(signInMismatch(true, 'none')).toBe(false);
    expect(signInMismatch(undefined, 'ANTHROPIC_API_KEY')).toBe(false);
    expect(signInMismatch(false, undefined)).toBe(false);
  });
});

describe('readJournal', () => {
  const line = (seq: number, fact: RunFact) => journalLine({ v: 1, seq, t: 0, ...fact });

  it('reads whole lines, and leaves out a last one cut short', () => {
    const whole = line(1, { kind: 'queued', text: 'héllo', at: 'end' }) + line(2, { kind: 'taken' });
    expect(readJournal(whole)).toEqual({ entries: [expect.objectContaining({ seq: 1, text: 'héllo' }), expect.objectContaining({ seq: 2 })], goodBytes: Buffer.byteLength(whole) });
    const torn = `${whole}{"v":1,"seq":3,"kind":"tur`;
    expect(readJournal(torn)).toEqual({ entries: [expect.objectContaining({ seq: 1 }), expect.objectContaining({ seq: 2 })], goodBytes: Buffer.byteLength(whole) });
  });

  it('skips a damaged line and carries on', () => {
    const text = `${line(1, { kind: 'taken' })}not json\n${line(3, { kind: 'cleared' })}`;
    expect(readJournal(text).entries.map((e) => e.seq)).toEqual([1, 3]);
    expect(readJournal('')).toEqual({ entries: [], goodBytes: 0 });
  });
});
