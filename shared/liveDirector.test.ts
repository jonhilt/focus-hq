import { describe, expect, it } from 'vitest';
import { captainsMove, liveStatus, liveStep, liveTick } from './liveDirector';
import type { SceneBeat } from './studio';

const beat = (more: Partial<SceneBeat> = {}): SceneBeat => ({ title: 'T', caption: 'C', hold: 4, ...more });
const beats = [beat(), beat({ do: 'start-goal', until: 'lead-working', hold: 2 }), beat({ until: 'shipped' })];

describe('captainsMove', () => {
  it('asks the captain to do what the recorder would', () => {
    expect(captainsMove(beat({ do: 'start-goal' }))).toMatch(/Start the goal/);
    expect(captainsMove(beat({ do: 'answer' }))).toMatch(/Answer the lead/);
    expect(captainsMove(beat({ do: 'reply', say: 'Ship it' }))).toBe('Tell the lead: “Ship it”');
    expect(captainsMove(beat())).toBeUndefined();
  });

  it('asks the captain to approve what the lead asks for, as the recorder would', () => {
    expect(captainsMove(beat({ until: 'shipped' }), true)).toBe('Approve what the lead asks for');
    expect(captainsMove(beat({ do: 'answer' }), true)).toMatch(/Answer the lead/);
  });
});

describe('liveTick', () => {
  it('leaves a beat without a cue to the captain’s key', () => {
    expect(liveTick(beats, { index: 0 }, true, 99_000)).toEqual({ index: 0 });
  });

  it('notes when the cue comes, and moves on once the hold is up', () => {
    const cued = liveTick(beats, { index: 1 }, true, 10_000);
    expect(cued).toEqual({ index: 1, cuedAt: 10_000 });
    expect(liveTick(beats, cued, true, 11_999)).toBe(cued);
    expect(liveTick(beats, cued, true, 12_000)).toEqual({ index: 2 });
  });

  it('waits while the cue hasn’t come', () => {
    expect(liveTick(beats, { index: 1 }, false, 10_000)).toEqual({ index: 1 });
  });

  it('stays on the last beat', () => {
    expect(liveTick(beats, { index: 2, cuedAt: 0 }, true, 99_000)).toEqual({ index: 2, cuedAt: 0 });
  });
});

describe('liveStep', () => {
  it('steps on and back within the scene, starting the beat afresh', () => {
    expect(liveStep(beats, { index: 1, cuedAt: 5 }, 1)).toEqual({ index: 2 });
    expect(liveStep(beats, { index: 1, cuedAt: 5 }, -1)).toEqual({ index: 0 });
    const first = { index: 0 };
    expect(liveStep(beats, first, -1)).toBe(first);
  });
});

describe('liveStatus', () => {
  it('says where it is and what it waits for', () => {
    expect(liveStatus(beats, { index: 1 })).toBe('Beat 2 of 3 · waits for lead working · ] next · [ back · O hide');
    expect(liveStatus(beats, { index: 1, cuedAt: 1 })).toMatch(/cue came/);
    expect(liveStatus(beats, { index: 0 })).toBe('Beat 1 of 3 · ] next · [ back · O hide');
  });
});
