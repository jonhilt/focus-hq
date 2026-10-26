import { describe, expect, it } from 'vitest';
import { age, agreed, bundleRows, bundleSays, doing, entryView, footOf, goalRow, goalSections, latestNews, newSince, pickGoal, seenOf, threadKey, threadRows } from './streamList';
import type { ThreadEntry } from './thread';

describe('new since the captain last looked', () => {
  const thread: ThreadEntry[] = [
    { kind: 'lead', at: 1, text: 'Plan?' },
    { kind: 'you', at: 2, text: 'Yes' },
    { kind: 'you', at: 5, text: 'And faster' },
    { kind: 'lead', at: 6, text: 'Done.' },
  ];
  it('falls before the first thing after they looked that isn’t their own', () => {
    expect(newSince(thread, 2)).toBe(3);
    expect(newSince(thread, 6)).toBe(-1);
    expect(newSince(thread, undefined)).toBe(-1);
  });
});

describe('how a thread’s entries read', () => {
  it('keeps the words as messages and the rest as quiet lines, the chief of staff’s words folded under its line', () => {
    expect(entryView({ kind: 'you', at: 1, text: 'Ship it', via: 'phone' })).toEqual({ as: 'you', text: 'Ship it', via: 'phone' });
    expect(entryView({ kind: 'lead', at: 1, text: 'Done.' })).toEqual({ as: 'lead', text: 'Done.' });
    expect(entryView({ kind: 'ops', at: 1, from: 'Ops', text: 'Slice 1 landed.' })).toEqual({ as: 'line', tone: 'quiet', text: 'Ops: Slice 1 landed.' });
    expect(entryView({ kind: 'merged', at: 1, repo: 'acme/shop', number: 3 })).toEqual({ as: 'line', tone: 'merged', text: 'Merged acme/shop#3' });
    expect(entryView({ kind: 'cos', at: 1, route: 4, why: 'No test behind it.', message: 'Test it first.' })).toEqual({ as: 'line', tone: 'sent-back', text: 'The chief of staff would send this back to the lead: No test behind it.', more: 'Test it first.' });
    expect(entryView({ kind: 'cos', at: 1, route: 2, why: 'A pick.' })).toMatchObject({ tone: 'cos', text: 'The chief of staff put this to you: A pick.' });
  });
});

describe('what a lead is doing', () => {
  it('says it in plain words, and as it is when it has none', () => {
    expect(doing('done')).toBe('between turns');
    expect(doing('error')).toBe('stopped on an error');
    expect(doing('reviewing')).toBe('reviewing');
  });
});

describe('when the captain last looked, as this browser kept it', () => {
  it('keeps only goals with a time, and nothing from what isn’t a record of them', () => {
    expect(seenOf({ g1: 5, g2: 'yesterday', g3: Number.NaN, g4: null })).toEqual({ g1: 5 });
    for (const not of [null, 'x', 3, [1, 2]]) expect(seenOf(not)).toEqual({});
  });
});

describe('the goal the stream shows', () => {
  const leads = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('keeps the one picked while it’s under way, else the first that needs the captain, else the first', () => {
    expect(pickGoal('c', leads, (id) => id === 'b')).toBe('c');
    expect(pickGoal('gone', leads, (id) => id === 'b')).toBe('b');
    expect(pickGoal(null, leads, () => false)).toBe('a');
    expect(pickGoal('a', [], () => false)).toBeNull();
  });
});

describe('a thread as it’s drawn', () => {
  const thread: ThreadEntry[] = [
    { kind: 'lead', at: 1, text: 'Plan?' },
    { kind: 'you', at: 2, text: 'Yes' },
    { kind: 'lead', at: 3, text: 'Done.' },
  ];
  it('is drawn again only when the lead’s status or its entries change', () => {
    expect(threadKey('g', 'working', thread)).toBe('g|working|3|3');
    expect(threadKey('g', 'done', [])).toBe('g|done|0|');
  });

  it('puts the line saying what’s new where it falls, and none when nothing is', () => {
    expect(threadRows(thread, 2).map((r) => ('entry' in r ? r.entry.at : 'new'))).toEqual([1, 2, 'new', 3]);
    expect(threadRows(thread, 3).map((r) => ('entry' in r ? r.entry.at : 'new'))).toEqual([1, 2, 3]);
  });
});

describe('the foot of a goal’s thread', () => {
  it('has the first thing that needs the captain which this browser knows of, else a box to talk to the lead', () => {
    const flagged = [{ id: 'turn:g:1', cos: { route: 2 as const, ask: 'a', why: 'w', message: '' } }, { id: 'hand:g:r1' }];
    expect(footOf('g', flagged, () => true)).toEqual({ card: 'turn:g:1', key: 'turn:g:1|2' });
    expect(footOf('g', flagged, (id) => id === 'hand:g:r1')).toEqual({ card: 'hand:g:r1', key: 'hand:g:r1|' });
    expect(footOf('g', flagged, () => false)).toEqual({ key: 'talk|g' });
    expect(footOf('g', [], () => true)).toEqual({ key: 'talk|g' });
  });
});

describe('when something last came into a thread', () => {
  it('is the latest entry that isn’t the captain’s own, and nothing in a thread with none', () => {
    expect(latestNews([{ kind: 'lead', at: 3, text: 'x' }, { kind: 'merged', at: 5, repo: 'r', number: 1 }, { kind: 'you', at: 9, text: 'y' }])).toBe(5);
    expect(latestNews([{ kind: 'you', at: 9, text: 'y' }])).toBeUndefined();
    expect(latestNews([])).toBeUndefined();
  });
});

describe('the goals on the left, every project in one list', () => {
  const projects = [{ id: 'p1', name: 'Focus' }, { id: 'p2', name: 'Shop' }, { id: 'p3', name: 'Empty' }];
  const goals = [{ id: 'a', projectId: 'p1' }, { id: 'b', projectId: 'p2' }, { id: 'c', projectId: 'p1' }, { id: 'd', projectId: 'p2' }];
  it('puts what needs the captain first, from any project, then each project’s others under its name, and no empty project', () => {
    expect(goalSections(goals, projects, (id) => id === 'd' || id === 'c').map((s) => [s.key, s.goals.map((g) => g.id)])).toEqual([['needs', ['c', 'd']], ['p1', ['a']], ['p2', ['b']]]);
    expect(goalSections(goals, projects, () => false).map((s) => s.name)).toEqual(['Focus', 'Shop']);
  });
});

describe('a goal’s compact row', () => {
  const now = 10 * 3_600_000;
  it('dots what needs the captain, then what’s new, then a lead stopped or at work, else quiet', () => {
    expect(goalRow(2, now - 60_000, now, 'error', now)).toEqual({ dot: 'needs', right: '2 for you' });
    expect(goalRow(0, now - 60_000, now - 120_000, 'working', now)).toEqual({ dot: 'new', right: '1m' });
    expect(goalRow(0, now - 3 * 3_600_000, now, 'error', now)).toEqual({ dot: 'error', right: '3h' });
    expect(goalRow(0, undefined, undefined, 'testing', now)).toEqual({ dot: 'working', right: '' });
    expect(goalRow(0, now - 50 * 3_600_000, undefined, 'done', now)).toEqual({ dot: 'quiet', right: '2d' });
  });
  it('says how long ago in a few characters', () => {
    expect([age(0), age(-5), age(59 * 60_000), age(90 * 60_000), age(36 * 3_600_000)]).toEqual(['now', 'now', '59m', '2h', '2d']);
  });
});

describe('quiet lines bundled', () => {
  const q = (at: number): ThreadEntry => ({ kind: 'ops', at, from: 'Ops', text: 'Following it.' });
  const said = (at: number): ThreadEntry => ({ kind: 'lead', at, text: 'Done.' });
  it('bundles two or more quiet lines in a row, leaves one alone, and keeps the new-since line where it was', () => {
    const rows = [{ entry: q(1) }, { entry: q(2) }, { entry: said(3) }, { entry: q(4) }, { newSince: true as const }, { entry: q(5) }, { entry: q(6) }];
    expect(bundleRows(rows)).toEqual([{ bundle: [q(1), q(2)] }, { entry: said(3) }, { entry: q(4) }, { newSince: true }, { bundle: [q(5), q(6)] }]);
  });
  it('says what a bundle amounts to: merges, QA passes, decisions, send-backs and flags', () => {
    expect(bundleSays([
      { kind: 'merged', at: 1, repo: 'a/b', number: 689 },
      { kind: 'ops', at: 2, from: 'QA officer Lt. Nakamura', text: 'QA passed a/b#689: fine.' },
      { kind: 'ops', at: 3, from: 'QA officer Lt. Nakamura', text: 'QA is reviewing a/b#690.' },
      { kind: 'decided', at: 4, question: 'Font?', chosen: 'Sans' },
      { kind: 'cos', at: 5, route: 4, why: 'No check.' },
      { kind: 'cos', at: 6, route: 3, why: 'Stuck.' },
    ])).toEqual(['merged #689', 'QA passed', 'decided: Sans', 'sent back once', 'flagged to you']);
    expect(bundleSays([{ kind: 'ops', at: 1, from: 'Ops', text: 'Following it.' }])).toEqual([]);
  });
});

describe('what’s agreed, for a goal’s header', () => {
  it('counts its pull requests merged, leaves out the closed, and lists what was decided', () => {
    expect(agreed([{ outcome: 'merged' }, {}, { outcome: 'closed' }], [{ kind: 'decided', at: 1, question: 'Layout?', chosen: 'B' }, { kind: 'lead', at: 2, text: 'ok' }]))
      .toEqual({ merged: 1, prs: 2, decided: [{ question: 'Layout?', chosen: 'B' }] });
  });
});
