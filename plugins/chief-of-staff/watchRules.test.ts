import { describe, expect, it } from 'vitest';
import { gradeOf, musterOrder, reachOf, stoodByKept, stripOf, toasts, watchOf } from './watchRules';

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

describe('the strip', () => {
  const waypoints = [{ slice: 1, title: 'Quick wins' }, { slice: 2, title: 'PDF parity', learned: ['Fee rows follow the PDF'] }, { slice: 3, heading: 'Signing flow' }];

  it('is a section per slice, the one it’s at last, then the first of the lead’s next ones', () => {
    const s = stripOf({ waypoints, artifacts: [], prs: [], questions: [] }, ['Portal', 'Reminders']);
    expect(s.slices.map((x) => [x.slice, x.name, x.now])).toEqual([[1, 'Quick wins', false], [2, 'PDF parity', false], [3, 'Signing flow', true]]);
    expect(s.next).toBe('Portal');
  });

  it('puts each exhibit in the slice it was last shown in, and one from before that was kept in the current slice', () => {
    const artifacts = [{ id: 'fees', title: 'Fee table', at: 1, slice: 2 }, { id: 'flow', title: 'Flow', at: 2, slice: 3, image: true }, { id: 'old', title: 'Old', at: 0 }];
    const s = stripOf({ waypoints, artifacts, prs: [], questions: [] }, []);
    expect(s.slices.map((x) => x.exhibits.map((e) => e.id))).toEqual([[], ['fees'], ['flow', 'old']]);
    expect(s.slices[2]?.exhibits[0]).toEqual({ id: 'flow', title: 'Flow', at: 2, image: true });
  });

  it('keeps each slice’s record: its merged pull requests, the questions answered in it, and what it taught', () => {
    const prs = [{ number: 1268, slice: 2, outcome: 'merged' as const, recap: { title: 'Fee rows follow the PDF' } }, { number: 1270, slice: 2, outcome: 'closed' as const }, { number: 1271, slice: 2, outcome: 'merged' as const }];
    const questions = [{ slice: 2, question: 'Bill on acceptance?', answer: { at: 5 } }, { slice: 2, question: 'Still open?' }];
    const two = stripOf({ waypoints, artifacts: [], prs, questions }, []).slices[1];
    expect(two?.shipped).toEqual(['#1268 Fee rows follow the PDF', '#1271']);
    expect(two?.decided).toEqual([{ what: 'Bill on acceptance?', at: 5 }]);
    expect(two?.taught).toEqual(['Fee rows follow the PDF']);
  });

  it('names a slice by its number until it has a title or heading, and shows no more than there is', () => {
    expect(stripOf({ waypoints: [{ slice: 1 }], artifacts: [], prs: [], questions: [] }, []).slices[0]?.name).toBe('Slice 1');
    expect(stripOf({ waypoints: [], artifacts: [], prs: [], questions: [] }, [])).toEqual({ slices: [] });
  });
});
