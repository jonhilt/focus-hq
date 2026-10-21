import { describe, expect, it } from 'vitest';
import { JUDGE_VERSION, judgePrompt, judgeSystemPrompt, parseVerdict } from './judge';

describe('the judge', () => {
  it('puts the captain’s standing orders in their place, or says there are none yet', () => {
    const prompt = judgeSystemPrompt('STANDING ORDERS\nWhen a lead asks, say yes.\n');
    expect(prompt).toContain("learned from their past replies:\nSTANDING ORDERS\nWhen a lead asks, say yes.\n\n\nHow to speak:");
    expect(prompt).toContain('message: always the actual words you would send');
    expect(judgeSystemPrompt(undefined)).toContain('past replies:\nNone yet');
    expect(judgeSystemPrompt('  \n')).toContain('past replies:\nNone yet');
    expect(JUDGE_VERSION).toBe('v7');
    expect(prompt).toContain('Spending money is always 3');
    expect(prompt).toContain('- ask: the headline');
  });

  it('reads the goal and the end of what the lead said, as the backtest did', () => {
    expect(judgePrompt('Saved items', 'Shall I?')).toBe('Goal: Saved items\n\nThe end of what the lead said:\n<<<\nShall I?\n>>>');
    expect(judgePrompt(undefined, 'Hi')).toContain('Goal: (untitled)');
  });

  it('takes a verdict of the four routes, with its headline and the words it would send on any of them', () => {
    expect(parseVerdict({ route: 4, ask: ' Run the tests first ', why: ' It can check. ', message: ' Run the tests. ' })).toEqual({ route: 4, ask: 'Run the tests first', why: 'It can check.', message: 'Run the tests.' });
    expect(parseVerdict({ route: 2, ask: 'Option A?', why: 'A pick.', message: 'Shall it go ahead with option A?' })).toEqual({ route: 2, ask: 'Option A?', why: 'A pick.', message: 'Shall it go ahead with option A?' });
    // with no headline, its reason stands in
    expect(parseVerdict({ route: 1, why: 'Progress.' })).toEqual({ route: 1, ask: 'Progress.', why: 'Progress.', message: '' });
    expect(parseVerdict({ route: 5, why: 'x', message: '' })).toBeUndefined();
    expect(parseVerdict({ route: 1, why: '', message: '' })).toBeUndefined();
    expect(parseVerdict('1')).toBeUndefined();
  });
});
