import { describe, expect, it } from 'vitest';
import { berths, bundleSays, conversation, doing, footOf, previewFor, seenOf } from './streamList';
import type { ThreadEntry } from './thread';

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

describe('what a goal’s sheet asks of the captain', () => {
  it('is the first thing that needs them which this browser knows of, else nothing', () => {
    const flagged = [{ id: 'turn:g:1', lane: 'needs-you' as const }, { id: 'hand:g:r1', lane: 'needs-you' as const }];
    expect(footOf(flagged, () => true)).toEqual({ card: 'turn:g:1' });
    expect(footOf(flagged, (id) => id === 'hand:g:r1')).toEqual({ card: 'hand:g:r1' });
    expect(footOf(flagged, () => false)).toEqual({});
    expect(footOf([], () => true)).toEqual({});
  });

  it('is words the chief of staff has ready when nothing needs them, never ahead of what does, and not a turn still being read', () => {
    const ready = { id: 'turn:g:2', lane: 'ready' as const };
    expect(footOf([ready], () => true)).toEqual({ card: 'turn:g:2', ready: true });
    expect(footOf([ready, { id: 'hand:g:r1', lane: 'needs-you' as const }], () => true)).toEqual({ card: 'hand:g:r1' });
    expect(footOf([{ id: 'turn:g:3', lane: 'judging' as const }], () => true)).toEqual({});
  });
});

describe('the rail’s berths', () => {
  it('lists each project’s goals under its name, in the projects’ order, and no empty project', () => {
    const goals = [{ id: 'a', projectId: 'p2' }, { id: 'b', projectId: 'p1' }, { id: 'c', projectId: 'p2' }];
    const projects = [{ id: 'p1', name: 'Shop' }, { id: 'p2', name: 'Focus' }, { id: 'p3', name: 'Empty' }];
    expect(berths(goals, projects).map((s) => [s.name, s.goals.map((g) => g.id)])).toEqual([['Shop', ['b']], ['Focus', ['a', 'c']]]);
  });
});

describe('what came in since the watch began', () => {
  it('says what it amounts to: merges, QA passes, send-backs and flags', () => {
    expect(bundleSays([
      { kind: 'merged', at: 1, repo: 'a/b', number: 689 },
      { kind: 'ops', at: 2, from: 'QA officer Lt. Nakamura', text: 'QA passed a/b#689: fine.' },
      { kind: 'ops', at: 3, from: 'QA officer Lt. Nakamura', text: 'QA is reviewing a/b#690.' },
      { kind: 'cos', at: 5, route: 4, why: 'No check.' },
      { kind: 'cos', at: 6, route: 3, why: 'Stuck.' },
    ])).toEqual(['merged #689', 'QA passed', 'sent back once', 'flagged to you']);
    expect(bundleSays([{ kind: 'ops', at: 1, from: 'Ops', text: 'Following it.' }])).toEqual([]);
    // QA's verdict is its first line: a failure whose findings mention a pass isn't one
    expect(bundleSays([{ kind: 'ops', at: 1, from: 'QA officer Lt. Nakamura', text: 'QA failed a/b#690.\nThe old tests passed; the new one didn’t.' }])).toEqual([]);
  });
});

describe('the panel and the exhibit', () => {
  it('keeps the conversation: their words, the user’s and what others told them, not the ledger’s lines', () => {
    const entries: ThreadEntry[] = [
      { kind: 'you', at: 1, text: 'Go' },
      { kind: 'ops', at: 2, from: 'Ops', text: 'Following it.' },
      { kind: 'lead', at: 3, text: 'Done.' },
      { kind: 'cos', at: 4, route: 1, why: 'Fine.' },
    ];
    expect(conversation(entries).map((e) => e.at)).toEqual([1, 2, 3]);
  });

  it('shows the project’s preview only when it runs one of this lead’s pull requests', () => {
    const preview = { repo: 'a/b', number: 5, links: [] };
    expect(previewFor(preview, [{ repo: 'a/b', number: 5 }])).toBe(preview);
    expect(previewFor(preview, [{ repo: 'a/b', number: 6 }])).toBeUndefined();
    expect(previewFor(undefined, [{ repo: 'a/b', number: 5 }])).toBeUndefined();
  });
});
