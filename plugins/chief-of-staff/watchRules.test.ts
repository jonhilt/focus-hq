import { describe, expect, it } from 'vitest';
import { chartStrip, gradeOf, musterOrder, reachOf, stoodByKept, toasts, watchOf } from './watchRules';

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

describe('the chart strip', () => {
  it('shows the last waypoint behind, the one it’s at and the next, the older ones counted', () => {
    const waypoints = [{ slice: 1, title: 'Quick wins' }, { slice: 2, title: 'PDF parity' }, { slice: 3, heading: 'Signing flow' }];
    expect(chartStrip(waypoints, ['Portal', 'Reminders'])).toEqual({ behind: 1, last: 'PDF parity', here: 'Signing flow', next: 'Portal' });
  });

  it('names a slice by its number until it has a title or heading, and shows no more than there is', () => {
    expect(chartStrip([{ slice: 1 }], [])).toEqual({ behind: 0, here: 'Slice 1' });
    expect(chartStrip([], [])).toEqual({ behind: 0 });
  });
});
