import { describe, expect, it } from 'vitest';
import type { AgentStatus, GoalNote } from '../../../shared/types';
import { goalRoomState, noteColumns, sliceProgress } from './goalRoom';

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

describe('noteColumns', () => {
  const note: GoalNote = {
    done: 'Each station is a door to its briefing room.',
    slice: [
      { text: 'Goal board', done: true },
      { text: 'Bigger sign', done: false },
    ],
    learned: ['one', 'two', 'three'],
    next: ['A pod', 'More'],
  };

  it('puts the slice’s checklist first, ticked items dimmed, then what’s next', () => {
    const [left] = noteColumns(note, 2);
    expect(left).toEqual([
      {
        heading: 'Slice 2',
        lines: 2,
        items: [
          { mark: '☑', text: 'Goal board', dim: true },
          { mark: '☐', text: 'Bigger sign', dim: false },
        ],
      },
      {
        heading: 'Next',
        lines: 1,
        items: [
          { mark: '→', text: 'A pod' },
          { mark: '→', text: 'More' },
        ],
      },
    ]);
  });

  it('puts what done looks like and the latest two lessons beside it', () => {
    const [, right] = noteColumns(note, 2);
    expect(right.map((s) => s.heading)).toEqual(['Done looks like', 'Learned']);
    expect(right[0].items).toEqual([{ mark: '◎', text: note.done }]);
    expect(right[1].items.map((i) => i.text)).toEqual(['two', 'three']);
  });

  it('leaves out sections with nothing in them', () => {
    expect(noteColumns({ done: '', slice: [], learned: [], next: [] }, 1)).toEqual([[], []]);
  });
});
