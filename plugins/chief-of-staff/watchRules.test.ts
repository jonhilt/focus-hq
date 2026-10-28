import { describe, expect, it } from 'vitest';
import { exhibitsOf, gradeOf, musterOrder, reachOf, stoodByKept, toasts, watchOf } from './watchRules';

describe('how hard something asks for the captain', () => {
  it('is a word for the lead on carry on and back to the lead, a decision on a card', () => {
    expect(gradeOf({ route: 1 })).toBe('word');
    expect(gradeOf({ route: 4 })).toBe('word');
    expect(gradeOf({ route: 2, check: 'irreversible' })).toBe('decision');
  });

  it('is a hail only on an interrupt for what can’t be undone or the lead contradicting them', () => {
    expect(gradeOf({ route: 3, check: 'irreversible' })).toBe('hail');
    expect(gradeOf({ route: 3, check: 'contradiction' })).toBe('hail');
    expect(gradeOf({ route: 3, check: 'overreach' })).toBe('decision');
    expect(gradeOf({ route: 3, check: 'captains' })).toBe('decision');
  });

  it('hails on an interrupt from before verdicts named their check, and waits on anything not judged', () => {
    expect(gradeOf({ route: 3 })).toBe('hail');
    expect(gradeOf(undefined)).toBe('decision');
  });
});

describe('the watch', () => {
  it('is on the goal at the conn while its lead is aboard', () => {
    expect(watchOf('a', (id) => id === 'a')).toBe('a');
    expect(watchOf('a', () => false)).toBeUndefined();
    expect(watchOf(undefined, () => true)).toBeUndefined();
  });

  it('puts the goal at the conn’s own on its sheet, whatever its grade', () => {
    for (const grade of ['hail', 'decision', 'word'] as const) expect(reachOf({ leadId: 'a', grade, stoodBy: false }, 'a')).toBe('sheet');
  });

  it('lets a hail from another goal break it, until it’s stood by', () => {
    expect(reachOf({ leadId: 'b', grade: 'hail', stoodBy: false }, 'a')).toBe('hail');
    expect(reachOf({ leadId: 'b', grade: 'hail', stoodBy: true }, 'a')).toBe('muster');
  });

  it('keeps another goal’s decisions in the muster, and words in its reports', () => {
    expect(reachOf({ leadId: 'b', grade: 'decision', stoodBy: false }, 'a')).toBe('muster');
    expect(reachOf({ grade: 'decision', stoodBy: false }, 'a')).toBe('muster');
    expect(reachOf({ leadId: 'b', grade: 'word', stoodBy: false }, 'a')).toBe('report');
  });

  it('sends everything but words to the muster with nobody at the conn', () => {
    expect(reachOf({ leadId: 'b', grade: 'hail', stoodBy: false }, undefined)).toBe('muster');
    expect(reachOf({ leadId: 'b', grade: 'word', stoodBy: false }, undefined)).toBe('report');
  });

  it('toasts only the goal at the conn and hails while it’s on, and everything without one', () => {
    expect(toasts('a', 'a', 'decision')).toBe(true);
    expect(toasts('a', 'b', 'decision')).toBe(false);
    expect(toasts('a', 'b', 'hail')).toBe(true);
    expect(toasts(undefined, 'b', 'decision')).toBe(true);
  });
});

describe('the muster', () => {
  it('orders by what each unblocks: hails, then someone idle, then the rest, oldest first', () => {
    const items = [
      { id: 'later', grade: 'decision' as const, idle: false, since: 1 },
      { id: 'idle', grade: 'decision' as const, idle: true, since: 5 },
      { id: 'hail', grade: 'hail' as const, idle: false, since: 9 },
      { id: 'earlier', grade: 'decision' as const, idle: false, since: 0 },
    ];
    expect(musterOrder(items).map((i) => i.id)).toEqual(['hail', 'idle', 'earlier', 'later']);
  });

  it('lets go of a hail stood by once it no longer waits', () => {
    expect(stoodByKept(['a', 'b'], new Set(['b', 'c']))).toEqual(['b']);
  });
});

describe('the exhibits panel', () => {
  const waypoints = [{ slice: 1, title: 'Quick wins' }, { slice: 2, title: 'PDF parity' }, { slice: 3, heading: 'Signing flow' }];
  const artifacts = [
    { id: 'fees', title: 'Fee table', at: 1, slice: 1 },
    { id: 'flow', title: 'Flow', at: 4, slice: 3, image: true },
    { id: 'footer', title: 'PDF footer', at: 3, slice: 1 },
    { id: 'old', title: 'Old', at: 0 },
  ];

  it('groups them by slice, the slice it’s at first, newest first within each, and leaves out a slice with none', () => {
    expect(exhibitsOf({ waypoints, artifacts }, 'slice').map((g) => [g.label, g.exhibits.map((x) => x.id)])).toEqual([
      ['3 · Signing flow · now', ['flow', 'old']],
      ['1 · Quick wins', ['footer', 'fees']],
    ]);
  });

  it('lists them all newest first, each with its slice, one shown before slices were kept as the current one', () => {
    const [all] = exhibitsOf({ waypoints, artifacts }, 'newest');
    expect(all?.exhibits.map((x) => [x.id, x.slice])).toEqual([['flow', 3], ['footer', 1], ['fees', 1], ['old', 3]]);
    expect(all?.exhibits[0]).toEqual({ id: 'flow', title: 'Flow', at: 4, slice: 3, image: true });
  });

  it('has no groups with nothing shown', () => {
    expect(exhibitsOf({ waypoints, artifacts: [] }, 'slice')).toEqual([]);
    expect(exhibitsOf({ waypoints: [], artifacts: [] }, 'newest')).toEqual([]);
  });
});
