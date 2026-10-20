import { describe, expect, it } from 'vitest';
import { JUDGE_VERSION, judgePrompt, judgeSystemPrompt, parseVerdict } from './judge';

describe('the judge', () => {
  it('puts the captain’s standing orders in their place, or says there are none yet', () => {
    const prompt = judgeSystemPrompt('STANDING ORDERS\nWhen a lead asks, say yes.\n');
    expect(prompt).toContain("learned from their past replies:\nSTANDING ORDERS\nWhen a lead asks, say yes.\n\n\nReply with JSON only");
    expect(judgeSystemPrompt(undefined)).toContain('past replies:\nNone yet');
    expect(judgeSystemPrompt('  \n')).toContain('past replies:\nNone yet');
    expect(JUDGE_VERSION).toBe('v5');
  });

  it('reads the goal and the end of what the lead said, as the backtest did', () => {
    expect(judgePrompt('Saved items', 'Shall I?')).toBe('Goal: Saved items\n\nThe end of what the lead said:\n<<<\nShall I?\n>>>');
    expect(judgePrompt(undefined, 'Hi')).toContain('Goal: (untitled)');
  });

  it('takes a verdict of the four routes, with a message for route 4 alone', () => {
    expect(parseVerdict({ route: 4, why: ' It can check. ', message: ' Run the tests. ' })).toEqual({ route: 4, why: 'It can check.', message: 'Run the tests.' });
    expect(parseVerdict({ route: 2, why: 'A pick.', message: 'ignored' })).toEqual({ route: 2, why: 'A pick.', message: '' });
    expect(parseVerdict({ route: 5, why: 'x', message: '' })).toBeUndefined();
    expect(parseVerdict({ route: 1, why: '', message: '' })).toBeUndefined();
    expect(parseVerdict('1')).toBeUndefined();
  });
});
