import { describe, expect, it } from 'vitest';
import { climbBrief, climbLogText } from '../climb';
import { findGapQuestion, followsRule, pickedGap, plantRejection, rankOnly, replayVerdict, sessionAnswer, sighting, type ClimbPick } from './climbReplayRules';

const pick: ClimbPick = {
  shortlist: [
    { gap: 'Split the manager’s sessions part', harm: 3, distance: 4, size: 'M' },
    { gap: 'Narrow the board’s lookups', harm: 2, distance: 3, size: 'S' },
    { gap: 'Test the merge loop', harm: 3, distance: 2, size: 'L' },
  ],
  chosen: 0,
  target: 'Target: crap.over 66 → 64',
  hypothesis: 'Two functions over CRAP 30 go.',
};

describe('plantRejection', () => {
  it('puts the control’s pick in the log, newest, closed by the captain with their reason, so the brief shows it as turned down', () => {
    const log = plantRejection([{ at: 5, pr: 3, title: 'Old', outcome: 'merged', words: [] }], pick, 'Not now: the sessions part is being rewritten.', 10);
    expect(log[0]).toMatchObject({ pr: 9999, title: 'Split the manager’s sessions part', outcome: 'closed', words: ['Not now: the sessions part is being rewritten.'] });
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

describe('a session’s pick', () => {
  it('is the entry it chose, and follows the rule when that’s the top by score', () => {
    expect(pickedGap(pick)).toBe('Split the manager’s sessions part');
    expect(followsRule(pick)).toBe(true);
    // 2×2+3 = 7 against the top's 2×3+4 = 10: chosen by mood, not by the rule
    expect(followsRule({ ...pick, chosen: 1 })).toBe(false);
    // a tie on score is still the rule's call
    expect(followsRule({ ...pick, shortlist: [...pick.shortlist, { gap: 'Tie', harm: 3, distance: 4, size: 'L' }], chosen: 3 })).toBe(true);
  });
});

describe('findGapQuestion', () => {
  it('numbers the session’s shortlist under the rejected gap for the judge', () => {
    const q = findGapQuestion('Split the manager’s sessions part', pick.shortlist);
    expect(q).toContain('A: Split the manager’s sessions part');
    expect(q).toContain('0. Split the manager’s sessions part\n1. Narrow the board’s lookups\n2. Test the merge loop');
  });
});

describe('sighting', () => {
  it('says whether the rejected gap was listed, and whether it was the one taken', () => {
    expect(sighting(pick, 0)).toEqual({ listed: true, taken: true });
    expect(sighting(pick, 2)).toEqual({ listed: true, taken: false });
    expect(sighting(pick, -1)).toEqual({ listed: false, taken: false });
  });
});

describe('replayVerdict', () => {
  const seen = (listed: boolean, taken = false) => ({ listed, taken });

  it('calls it remembered when the control lists the rejected gap and no treatment session takes it', () => {
    expect(replayVerdict([seen(true), seen(false)], [seen(true), seen(false), seen(false)], [pick, { ...pick, chosen: 1 }])).toEqual({
      control: { listed: 1, taken: 0, of: 2 }, treatment: { listed: 1, taken: 0, of: 3 }, followedRule: { yes: 1, of: 2 }, verdict: 'remembered',
    });
  });

  it('calls it repeated when the treatment takes it at least as often as the control', () => {
    expect(replayVerdict([seen(true, true), seen(false)], [seen(true, true), seen(false)]).verdict).toBe('repeated');
  });

  it('won’t call it either way when the gap was no contender, or the treatment took it less often but not never', () => {
    // no other control session even listed it, so avoiding it proves nothing
    expect(replayVerdict([seen(false), seen(false)], [seen(false), seen(false)]).verdict).toBe('inconclusive');
    expect(replayVerdict([seen(true, true), seen(true, true)], [seen(true, true), seen(true), seen(true), seen(true)]).verdict).toBe('inconclusive');
  });
});

describe('sessionAnswer', () => {
  const ended = { subtype: 'success', is_error: false, result: 'Done', structured_output: { chosen: 1 }, total_cost_usd: 0.25 };

  it('gives a successful session\'s structured answer and its cost', () => {
    expect(sessionAnswer(ended)).toEqual({ answer: { chosen: 1 }, costUsd: 0.25 });
  });

  it('throws the error a session ended on: its subtype, or the result of a success that failed', () => {
    expect(() => sessionAnswer({ ...ended, subtype: 'error_max_turns', result: undefined })).toThrow('error_max_turns');
    expect(() => sessionAnswer({ ...ended, is_error: true, result: 'Credit balance is too low' })).toThrow('Credit balance is too low');
  });
});
