import { describe, expect, it } from 'vitest';
import { evolve, factLine, fold, journalLine, readJournal, replay, type RunFact, runView, stoppedNote } from './runJournal';

const requested = (turn: string, prompt = 'Fix the flaky test', resumes?: string): RunFact => ({ kind: 'turn-requested', turn, turnKind: 'work', prompt, resumes });

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

  it('keeps a lead’s notes apart from their messages, for whatever they hear next, ahead of it', () => {
    const noted = fold([{ kind: 'queued', text: '[Ops] Slice 1 has landed', at: 'note' }, { kind: 'queued', text: 'b', at: 'later' }, { kind: 'released' }]);
    // a note isn't a message: a turn ending with only notes waiting doesn't carry on
    expect(noted).toMatchObject({ notes: ['[Ops] Slice 1 has landed'], inbox: ['b'], later: [] });
    // taken for a prompt, they're owed ahead of the messages, and back in the inbox after a restart
    expect(fold([{ kind: 'queued', text: 'Go on', at: 'end' }, { kind: 'queued', text: 'note', at: 'note' }, { kind: 'taken' }])).toMatchObject({ notes: [], inbox: [], owed: ['note', 'Go on'] });
    expect(fold([{ kind: 'queued', text: 'note', at: 'note' }, { kind: 'taken' }, { kind: 'restored' }])).toMatchObject({ notes: [], inbox: ['note'] });
    // into a turn's session, ahead of a message sent there
    const sent = fold([requested('t1'), { kind: 'queued', text: 'note', at: 'note' }, { kind: 'notes-sent', turn: 't1' }, { kind: 'sent', turn: 't1', text: 'Go on' }]);
    expect(sent).toMatchObject({ notes: [], open: { sent: ['note', 'Go on'] } });
    // not into a turn that isn't open: they wait on
    expect(fold([requested('t1'), { kind: 'queued', text: 'note', at: 'note' }, { kind: 'notes-sent', turn: 't0' }]).notes).toEqual(['note']);
    expect(fold([{ kind: 'queued', text: 'note', at: 'note' }, { kind: 'cleared' }]).notes).toEqual([]);
    expect(factLine({ kind: 'queued', text: 'QA passed it', at: 'note' })).toBe('Note for them, heard with their next message: QA passed it');
  });

  // docs/invariants.md#found-on-main: a stop lost what was written into the turn, where a restart kept it
  it('keeps what went into a turn the captain stopped as a note for their next message, in case it never reached them', () => {
    const into = [requested('t1'), { kind: 'turn-started', turn: 't1', session: 's1' }, { kind: 'queued', text: 'QA passed', at: 'note' }, { kind: 'notes-sent', turn: 't1' }, { kind: 'sent', turn: 't1', text: 'And the header' }] satisfies RunFact[];
    const unheard = [stoppedNote(['QA passed', 'And the header'])];
    expect(fold([...into, { kind: 'stop-requested', turn: 't1' }, { kind: 'turn-ended', turn: 't1', outcome: { ok: false, aborted: true } }])).toMatchObject({ notes: unheard, inbox: [] });
    // stopped, then Focus went down before the turn ended
    expect(fold([...into, { kind: 'stop-requested', turn: 't1' }, { kind: 'interrupted', turn: 't1' }])).toMatchObject({ notes: unheard, inbox: [] });
    // a turn that ran on heard it; one Focus cut off is picked back up with it (`resumedNote`)
    expect(fold([...into, { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }]).notes).toEqual([]);
    expect(fold([...into, { kind: 'interrupted', turn: 't1' }]).notes).toEqual([]);
    expect(stoppedNote(['a'])).toMatch(/^\[Ops\] /);
  });

  it('starts from nothing when the agent was sent home, numbering on', () => {
    const run = fold([{ kind: 'queued', text: 'a', at: 'later' }, { kind: 'taken' }, requested('t1'), { kind: 'reset' }]);
    expect(run).toEqual({ inbox: [], later: [], notes: [], owed: [], turns: 0, phase: 'idle', seq: 4 });
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

describe('the journal’s machine', () => {
  const phases = (facts: RunFact[]) => facts.map((_, i) => runView(fold(facts.slice(0, i + 1))).phase);

  it('follows a run through its phases, fact by fact', () => {
    expect(
      phases([
        { kind: 'waiting' },
        { kind: 'setting-up' },
        requested('t1'),
        { kind: 'turn-started', turn: 't1', session: 's1' },
        { kind: 'turn-ended', turn: 't1', outcome: { ok: true } },
        { kind: 'decided', turn: 't1', target: 'deliver' },
        requested('t2', 'Fix the review'),
        { kind: 'stop-requested', turn: 't2' },
        { kind: 'turn-ended', turn: 't2', outcome: { ok: false, aborted: true } },
        { kind: 'reset' },
      ]),
    ).toEqual(['waiting', 'setting-up', 'turn.requested', 'turn.started', 'ended', 'ended', 'turn.requested', 'turn.stopping', 'ended', 'idle']);
  });

  it('keeps what followed the last turn, and counts the turns of work', () => {
    const run = fold([requested('t1'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }, { kind: 'decided', turn: 't1', target: 'lead-done' }]);
    expect(runView(run)).toEqual({ phase: 'ended', turns: 1, target: 'lead-done', seq: 3 });
    // a compaction isn't a turn of work, and a decision about another turn changes nothing
    const later = fold([requested('t1'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }, { kind: 'decided', turn: 't0', target: 'fail' }, { kind: 'turn-requested', turn: 'c1', turnKind: 'compact', prompt: '/compact' }]);
    expect(runView(later)).toEqual({ phase: 'turn.requested', turns: 1, seq: 4 });
  });

  it('is interrupted only from a turn, and a mismatch stops it', () => {
    expect(runView(fold([requested('t1'), { kind: 'interrupted', turn: 't1' }])).phase).toBe('interrupted');
    expect(runView(fold([{ kind: 'interrupted', turn: 't1' }])).phase).toBe('idle');
    expect(runView(fold([requested('t1'), { kind: 'turn-started', turn: 't1', session: 's1' }, { kind: 'sign-in-mismatch', turn: 't1', observed: 'apiKeyHelper' }])).phase).toBe('turn.stopping');
  });
});

describe('a delivery in the journal', () => {
  const ended: RunFact[] = [requested('t1'), { kind: 'turn-ended', turn: 't1', outcome: { ok: true } }, { kind: 'decided', turn: 't1', target: 'deliver' }];
  const delivering: RunFact[] = [...ended, { kind: 'delivering', turn: 't1', summary: 'Dark mode' }];

  it('follows the work onto GitHub, keyed by the turn whose work it is', () => {
    expect(runView(fold(delivering)).phase).toBe('delivering.pushing');
    expect(runView(fold([...delivering, { kind: 'pushed', turn: 't1' }])).phase).toBe('delivering.opening');
    expect(runView(fold([...delivering, { kind: 'pushed', turn: 't1' }, { kind: 'delivered', turn: 't1', outcome: 'pr', pr: 412 }]))).toMatchObject({ phase: 'delivered', target: 'deliver', pr: 412 });
    expect(fold([...delivering, { kind: 'delivery-failed', turn: 't1', error: 'GitHub said no' }])).toMatchObject({ phase: 'failed', delivery: { error: 'GitHub said no' } });
    // a fact about another turn's delivery changes nothing, nor does delivering a turn that isn't the last
    expect(runView(fold([...delivering, { kind: 'pushed', turn: 't0' }])).phase).toBe('delivering.pushing');
    expect(runView(fold([...ended, { kind: 'delivering', turn: 't0', summary: 'Old' }])).phase).toBe('ended');
  });
});

describe('a raised hand and a hold in the journal', () => {
  const started: RunFact[] = [requested('t1', 'Go', 's1'), { kind: 'turn-started', turn: 't1', session: 's1' }];

  it('raises the hand in the turn, and puts it down with the captain’s answer or the turn’s end', () => {
    const asking = [...started, { kind: 'asked', turn: 't1', tool: 'Bash', summary: 'npm publish' } as RunFact];
    expect(fold(asking)).toMatchObject({ phase: { turn: 'asking' }, asking: { tool: 'Bash', summary: 'npm publish' } });
    expect(fold([...asking, { kind: 'answered', turn: 't1', allow: true }])).toMatchObject({ phase: { turn: 'started' }, asking: undefined });
    expect(fold([...asking, { kind: 'turn-ended', turn: 't1', outcome: { ok: false, aborted: true } }])).toMatchObject({ phase: 'ended', asking: undefined });
    // another turn's hand isn't this one's
    expect(runView(fold([...started, { kind: 'asked', turn: 't0', tool: 'Bash', summary: 'x' }])).phase).toBe('turn.started');
  });

  it('holds the run for the plan’s limit, and lets it go', () => {
    const held = fold([...started, { kind: 'turn-ended', turn: 't1', outcome: { ok: false, limited: true } }, { kind: 'held', until: 5000 }]);
    expect(held).toMatchObject({ phase: 'held', heldUntil: 5000 });
    expect(evolve(held, { kind: 'unheld' })).toMatchObject({ phase: 'idle', heldUntil: undefined });
    expect(runView(evolve(evolve(held, { kind: 'unheld' }), { kind: 'waiting' })).phase).toBe('waiting');
  });
});

describe('replay', () => {
  it('tells each fact in words, with where the run was after it', () => {
    const facts: RunFact[] = [
      { kind: 'queued', text: 'Fix   the\nflaky test', at: 'end' },
      { kind: 'taken' },
      requested('t1', 'Fix the flaky test'),
      { kind: 'signed-in', turn: 't1', onKey: false },
      { kind: 'turn-started', turn: 't1', session: 'session-1234abcd', keySource: 'none' },
      { kind: 'asked', turn: 't1', tool: 'Bash', summary: 'npm publish' },
      { kind: 'answered', turn: 't1', allow: true },
      { kind: 'turn-ended', turn: 't1', outcome: { ok: true } },
      { kind: 'decided', turn: 't1', target: 'deliver' },
      { kind: 'delivering', turn: 't1', summary: 'Flaky test fixed' },
      { kind: 'pushed', turn: 't1' },
      { kind: 'delivered', turn: 't1', outcome: 'pr', pr: 412 },
    ];
    const steps = replay(facts.map((f, i) => ({ v: 1, seq: i + 1, t: 1000 + i, ...f })));
    expect(steps.map((s) => [s.seq, s.run.phase, s.fact])).toEqual([
      [1, 'idle', 'Message for them: Fix the flaky test'],
      [2, 'idle', 'Messages taken into the next prompt'],
      [3, 'turn.requested', 'Turn asked for, in a new conversation: Fix the flaky test'],
      [4, 'turn.requested', 'Signs in with your plan'],
      [5, 'turn.started', 'Claude Code has it: session session-, credential from none'],
      [6, 'turn.asking', 'Hand up: approval for npm publish'],
      [7, 'turn.started', 'The captain approved'],
      [8, 'ended', 'Turn ended'],
      [9, 'ended', 'What follows: deliver'],
      [10, 'delivering.pushing', 'Putting the work on GitHub'],
      [11, 'delivering.opening', 'The branch is on GitHub'],
      [12, 'delivered', 'Pull request #412 ready'],
    ]);
    expect(steps[11]).toMatchObject({ t: 1011, kind: 'delivered', run: { turns: 1, target: 'deliver', pr: 412 } });
  });

  it('says how a turn ended, and why a delivery didn’t happen', () => {
    expect(factLine({ kind: 'turn-ended', turn: 't', outcome: { ok: false, limited: true } })).toBe("Turn stopped by your plan's usage limit");
    expect(factLine({ kind: 'turn-ended', turn: 't', outcome: { ok: false, error: 'npm exploded' } })).toBe('Turn failed: npm exploded');
    expect(factLine({ kind: 'delivered', turn: 't', outcome: 'no-commits' })).toBe('Nothing to deliver: no commits');
    expect(factLine({ kind: 'answered', turn: 't', allow: false, dropped: true })).toBe('Hand down: the turn ended first');
    expect(factLine({ kind: 'queued', text: 'x'.repeat(200), at: 'later' })).toMatch(/^Message for them, once the turn ends: x{119}…$/);
  });
});
