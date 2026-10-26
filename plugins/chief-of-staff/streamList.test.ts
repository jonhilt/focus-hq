import { describe, expect, it } from 'vitest';
import { doing, entryView, footOf, goalLine, headLine, latestNews, newSince, pickGoal, seenOf, threadKey, threadRows } from './streamList';
import type { ThreadEntry } from './thread';

describe('a goal’s line in the stream', () => {
  it('leads with what needs the captain, then what’s new since they looked, then what the lead is doing', () => {
    expect(goalLine([{ what: 'Plan to review' }, { what: 'Merge #3' }], 10, 20, 'working')).toEqual({ tone: 'needs', text: 'Needs you · Plan to review (+1)' });
    expect(goalLine([], 30, 20, 'working')).toEqual({ tone: 'new', text: 'New since you looked' });
    expect(goalLine([], 10, 20, 'working')).toEqual({ tone: 'quiet', text: 'working' });
    expect(goalLine([], 10, undefined, 'done')).toEqual({ tone: 'quiet', text: 'done' });
  });
});

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
    expect(entryView({ kind: 'decided', at: 1, question: 'List or grid?', chosen: 'List' })).toEqual({ as: 'line', tone: 'decided', text: 'Decided: List or grid? → List' });
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

  it('says who leads it, what they’re doing and what done looks like', () => {
    expect(headLine('Lt. Vale', 'done', 'It ships.')).toBe('Lt. Vale · between turns · Done looks like: It ships.');
    expect(headLine('Lt. Vale', 'working')).toBe('Lt. Vale · working');
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
