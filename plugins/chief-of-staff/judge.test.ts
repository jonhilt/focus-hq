import { describe, expect, it } from 'vitest';
import { JUDGE_VERSION, judgePrompt, judgeSystemPrompt, parseVerdict, VERDICT_SCHEMA } from './judge';
import { MAX_REPLIES, MAX_REPLY_LABEL } from './shared';
import { demoReplies } from './demoJudge';

describe('the judge', () => {
  it('puts the captain’s standing orders in their place, or says there are none yet', () => {
    const prompt = judgeSystemPrompt('STANDING ORDERS\nWhen a lead asks, say yes.\n');
    expect(prompt).toContain("learned from their past replies:\nSTANDING ORDERS\nWhen a lead asks, say yes.\n\n\nHow to speak:");
    expect(prompt).toContain('message: always the actual words you would send');
    expect(judgeSystemPrompt(undefined)).toContain('past replies:\nNone yet');
    expect(judgeSystemPrompt('  \n')).toContain('past replies:\nNone yet');
    expect(JUDGE_VERSION).toBe('v9');
    expect(prompt).toContain('- replies: buttons for the captain');
    expect(prompt).toContain('3 at most');
    expect(prompt).toContain('Spending money is always 3');
    expect(prompt).toContain('- ask: the headline');
  });

  it('reasons from principles, the routes following from them, and leans towards the captain when unsure', () => {
    const prompt = judgeSystemPrompt();
    for (const p of ['P1. The captain’s attention', 'P2. Direction is the captain’s', 'P3. Never decide for the captain', 'P4. Prepare, don’t pass through', 'P5.', 'P6.', 'P7. The costs are lopsided']) expect(prompt.replaceAll("'", '’')).toContain(p);
    expect(prompt).toContain('Unsure between 4 and 2: choose 2 (P7)');
    expect(prompt).toContain('Never use 1 or 4 for something under ALWAYS THE CAPTAIN\'S');
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

  it('takes the replies it suggests, each a label and the captain’s words, and none when it gives none', () => {
    const replies = [{ label: ' Keep it open ', text: ' Keep the goal open: there’s more. ' }, { label: 'Close it', text: 'Close it.' }, { label: 'Close it', text: 'Twice' }, { label: 'No words' }];
    expect(parseVerdict({ route: 2, ask: 'Close?', why: 'A pick.', message: 'm', replies })?.replies).toEqual([{ label: 'Keep it open', text: 'Keep the goal open: there’s more.' }, { label: 'Close it', text: 'Close it.' }]);
    expect(parseVerdict({ route: 1, why: 'Progress.', message: '', replies: [] })).not.toHaveProperty('replies');
    expect(VERDICT_SCHEMA.required).toContain('replies');
  });

  it('asks for short labels and three replies at most, and drops a label too long for its button', () => {
    expect(judgeSystemPrompt()).toContain(`${MAX_REPLY_LABEL} characters at most`);
    expect(VERDICT_SCHEMA.properties.replies.maxItems).toBe(MAX_REPLIES);
    const replies = [{ label: 'Keep the goal open and start the settings page slice next', text: 'Keep it open.' }, { label: 'Close it', text: 'Close it.' }];
    expect(parseVerdict({ route: 2, ask: 'Close?', why: 'A pick.', message: 'm', replies })?.replies).toEqual([{ label: 'Close it', text: 'Close it.' }]);
  });
});

describe('the demo’s judge', () => {
  it('suggests replies fitted to the question it knows, yes or not yet otherwise', () => {
    expect(demoReplies('Keep the goal open, or close it?').map((r) => r.label)).toEqual(['Keep it open', 'Close it']);
    expect(demoReplies('Want me to redraw that part?').map((r) => r.label)).toEqual(['Yes, redraw it', 'No need']);
    expect(demoReplies('Shall I go ahead?').map((r) => r.label)).toEqual(['Go ahead', 'Not yet']);
  });
});
