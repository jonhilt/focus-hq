import { describe, expect, it } from 'vitest';
import type { AgentStatus, GoalNote } from '../../../shared/types';
import { checklistGlance, goalRoomState, leadNow, noteSections, prGlance, roster, rowAt, sliceProgress } from './goalRoom';

describe('goalRoomState', () => {
  const lead = (status: AgentStatus) => ({ status });

  it('is free with no lead', () => {
    expect(goalRoomState(undefined)).toEqual({ tone: 'free', label: 'Free' });
  });

  it('is in session while the lead works', () => {
    for (const s of ['setting-up', 'working', 'testing', 'pushing'] as const) expect(goalRoomState(lead(s)).tone).toBe('in-session');
  });

  it('needs you when the lead has their hand up, and is your turn when they’ve finished theirs', () => {
    expect(goalRoomState(lead('waiting'))).toEqual({ tone: 'needs-you', label: 'Needs you' });
    expect(goalRoomState(lead('done'))).toEqual({ tone: 'your-turn', label: 'Your turn' });
  });

  it('needs your answer while the lead has a question open, unless something more pressing is up', () => {
    const asking = (status: AgentStatus, answered = false) => ({
      status,
      lead: { questions: [{ id: 'q1', question: 'Which?', options: [], at: 1, ...(answered ? { answer: { option: 'a', at: 2 } } : {}) }] } as never,
    });
    expect(goalRoomState(asking('done'))).toEqual({ tone: 'needs-you', label: 'Your answer' });
    expect(goalRoomState(asking('working'))).toEqual({ tone: 'needs-you', label: 'Your answer' });
    expect(goalRoomState(asking('done', true))).toEqual({ tone: 'your-turn', label: 'Your turn' });
    expect(goalRoomState(asking('waiting'))).toEqual({ tone: 'needs-you', label: 'Needs you' });
    expect(goalRoomState(asking('error')).tone).toBe('stopped');
  });

  it('is queued while the lead waits for a slot, and stopped once they’ve stopped or failed', () => {
    expect(goalRoomState(lead('queued'))).toEqual({ tone: 'queued', label: 'Queued' });
    expect(goalRoomState(lead('stopped'))).toEqual({ tone: 'stopped', label: 'Stopped' });
    expect(goalRoomState(lead('error'))).toEqual({ tone: 'stopped', label: 'Stopped' });
  });
});

describe('sliceProgress', () => {
  const note = (done: boolean[]): GoalNote => ({ done: '', slice: done.map((d, i) => ({ text: `${i}`, done: d })), learned: [], next: [] });

  it('is how much of the checklist is ticked off, to the nearest percent', () => {
    expect(sliceProgress(note([true, false, false]))).toBe(33);
    expect(sliceProgress(note([true, true]))).toBe(100);
    expect(sliceProgress(note([false]))).toBe(0);
  });

  it('is nothing without a checklist', () => {
    expect(sliceProgress(undefined)).toBeNull();
    expect(sliceProgress(note([]))).toBeNull();
  });
});

describe('noteSections', () => {
  const note: GoalNote = {
    done: 'Each station is a door to its briefing room.',
    slice: [
      { text: 'Goal board', done: true },
      { text: 'Bigger sign', done: false },
    ],
    learned: ['one', 'two', 'three'],
    next: ['A pod'],
  };

  it('puts the slice’s checklist first, ticked items dimmed, then done, next and the latest two lessons', () => {
    const sections = noteSections(note, 2);
    expect(sections.map((s) => s.heading)).toEqual(['Slice 2 · 1 of 2', 'Done looks like', 'Next', 'Learned']);
    expect(sections[0].items).toEqual([
      { mark: '☑', text: 'Goal board', dim: true },
      { mark: '☐', text: 'Bigger sign', dim: false },
    ]);
    expect(sections[3].items.map((i) => i.text)).toEqual(['two', 'three']);
  });

  it('puts the slice and what done looks like under the goal, and next and the lessons under the crew', () => {
    expect(noteSections(note, 2).map((s) => s.side)).toEqual(['goal', 'goal', 'crew', 'crew']);
  });

  it('leaves out sections with nothing in them', () => {
    expect(noteSections({ done: '', slice: [], learned: [], next: [] }, 1)).toEqual([]);
  });
});

describe('rowAt', () => {
  const rows = [
    { top: 100, bottom: 200 },
    { top: 200, bottom: 300 },
  ];

  it('finds the row a point is on, the boundary going to the row below', () => {
    expect(rowAt(rows, 150)).toBe(0);
    expect(rowAt(rows, 200)).toBe(1);
  });

  it('finds none above, below or with no rows', () => {
    expect(rowAt(rows, 50)).toBeUndefined();
    expect(rowAt(rows, 300)).toBeUndefined();
    expect(rowAt([], 150)).toBeUndefined();
  });
});

describe('roster', () => {
  it('lists the lead, then the reviewer, then whichever helpers are seated', () => {
    expect(roster('lead', 'qa', [undefined, 'h2', 'h3'])).toEqual([
      { who: 'lead', role: 'Lead' },
      { who: 'qa', role: 'Reviewer' },
      { who: 'h2', role: 'Helper' },
      { who: 'h3', role: 'Helper' },
    ]);
  });

  it('is empty at a free station', () => {
    expect(roster(undefined, undefined, [undefined])).toEqual([]);
  });
});

describe('leadNow', () => {
  const lead = (status: AgentStatus, more: object = {}) => ({ status, activity: 'Writing the wishlist API', ...more });

  it('is what the lead is doing while they work, or last did once it’s your turn', () => {
    expect(leadNow(lead('working'))).toBe('Writing the wishlist API');
    expect(leadNow(lead('done'))).toBe('Writing the wishlist API');
    expect(leadNow(lead('done', { activity: '' }))).toBe('Waiting for your reply');
  });

  it('says what they need from you: an approval, an answer, or closing the goal', () => {
    expect(leadNow(lead('waiting', { permission: { id: 'p', tool: 'ship', summary: 'Ship slice 2', at: 1 } }))).toBe('Asking you: Ship slice 2');
    const question = { id: 'q1', question: 'Which layout?', options: [], at: 1 };
    expect(leadNow(lead('working', { lead: { questions: [question] } }))).toBe('Asked you: Which layout?');
    expect(leadNow(lead('done', { lead: { closing: { reason: 'Done looks done', at: 1 } } }))).toBe('Ready to wrap up: Done looks done');
  });

  it('says when they’ve stopped, failed or are waiting for a slot', () => {
    expect(leadNow(lead('stopped'))).toBe('Stopped');
    expect(leadNow(lead('error', { error: 'No repos' }))).toBe('Hit a problem: No repos');
    expect(leadNow(lead('queued'))).toBe('Waiting for a free slot to carry on');
  });
});

describe('checklistGlance', () => {
  const items = (done: boolean[]) => done.map((d, i) => ({ text: `${i}`, done: d }));

  it('shows the whole checklist when it fits', () => {
    expect(checklistGlance(items([true, false]), 4)).toEqual({ done: 0, items: items([true, false]), more: 0 });
  });

  it('folds the ticked-off items at the top into one line', () => {
    const glance = checklistGlance(items([true, true, true, false, false]), 3);
    expect(glance).toEqual({ done: 3, items: [{ text: '3', done: false }, { text: '4', done: false }], more: 0 });
  });

  it('says how many more there are when what’s left doesn’t fit', () => {
    const glance = checklistGlance(items([true, false, false, false, false]), 3);
    expect(glance.done).toBe(1);
    expect(glance.items.map((i) => i.text)).toEqual(['1']);
    expect(glance.more).toBe(3);
    expect(checklistGlance(items([false, false, false, false]), 3)).toEqual({ done: 0, items: items([false, false]), more: 2 });
  });

  it('is just the tally once everything’s ticked off', () => {
    expect(checklistGlance(items([true, true, true, true]), 3)).toEqual({ done: 4, items: [], more: 0 });
  });
});

describe('prGlance', () => {
  it('is how it ended, once it has', () => {
    expect(prGlance({ outcome: 'merged' }, 'failed')).toBe('merged');
    expect(prGlance({ outcome: 'closed' }, undefined)).toBe('closed');
  });

  it('is how QA has it while it’s open', () => {
    expect(prGlance({}, 'queued')).toBe('testing');
    expect(prGlance({}, 'testing')).toBe('testing');
    expect(prGlance({}, 'passed')).toBe('passed');
    expect(prGlance({}, 'failed')).toBe('failed');
    expect(prGlance({}, 'error')).toBe('open');
    expect(prGlance({}, undefined)).toBe('open');
  });
});
