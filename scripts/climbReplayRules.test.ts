import { describe, expect, it } from 'vitest';
import { climbBrief, climbLogText } from '../server/agents/climb';
import { plantRejection, rankOnly, replayVerdict, sameGapQuestion } from './climbReplayRules';

const pick = { gap: 'Split the manager’s sessions part', target: 'Target: crap.over 66 → 64', hypothesis: 'Two functions over CRAP 30 go.' };

describe('plantRejection', () => {
  it('puts the control’s pick in the log, newest, closed by the captain with their reason, so the brief shows it as turned down', () => {
    const log = plantRejection([{ at: 5, pr: 3, title: 'Old', outcome: 'merged', words: [] }], pick, 'Not now: the sessions part is being rewritten.', 10);
    expect(log[0]).toMatchObject({ pr: 9999, title: pick.gap, outcome: 'closed', words: ['Not now: the sessions part is being rewritten.'] });
    const text = climbLogText(log);
    expect(text).toContain('Split the manager’s sessions part (CLOSED UNMERGED by the captain)');
    expect(text).toContain('The captain said: “Not now: the sessions part is being rewritten.”');
    expect(text.indexOf('9999')).toBeLessThan(text.indexOf('#3'));
  });
});

describe('rankOnly', () => {
  it('keeps the whole brief and asks for steps 0 to 2 only, from the numbers given', () => {
    const brief = climbBrief({ repo: 'a/b', baseBranch: 'main', branch: 'focus/climb-x' }, [], 0);
    const prompt = rankOnly(brief, 'gate.seconds 100');
    expect(prompt.startsWith(brief)).toBe(true);
    expect(prompt).toContain('Change nothing, and run nothing');
    expect(prompt.endsWith('gate.seconds 100')).toBe(true);
  });
});

describe('sameGapQuestion', () => {
  it('sets the two picks side by side for the judge', () => {
    const q = sameGapQuestion(pick, { ...pick, gap: 'Narrow the board' });
    expect(q).toContain('A: Split the manager’s sessions part');
    expect(q).toContain('B: Narrow the board');
  });
});

describe('replayVerdict', () => {
  it('calls it remembered when no treatment session repeats a gap the control converged on', () => {
    expect(replayVerdict([true, true], [false, false, false])).toEqual({ control: { same: 2, of: 2 }, treatment: { same: 0, of: 3 }, verdict: 'remembered' });
  });

  it('calls it repeated when the treatment takes the rejected gap as often as the control converges on it', () => {
    expect(replayVerdict([true, false], [true, false, true]).verdict).toBe('repeated');
  });

  it('won’t call it either way when the control never converged, or the treatment repeated it less but not never', () => {
    // nothing drew the control back to that gap, so avoiding it proves nothing
    expect(replayVerdict([false, false], [false, false]).verdict).toBe('inconclusive');
    expect(replayVerdict([true, true], [true, false, false, false]).verdict).toBe('inconclusive');
  });
});
