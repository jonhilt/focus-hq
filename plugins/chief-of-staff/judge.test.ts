import { describe, expect, it } from 'vitest';
import { judgePrompt, judgeSystemPrompt, judgeVersion, parseVerdict, VERDICT_SCHEMA, verdictSchema } from './judge';
import { MAX_ASKS, MAX_REPLIES, MAX_REPLY_LABEL } from './shared';
import { demoAsks, demoReplies } from './demoJudge';

describe('the judge', () => {
  it('puts the captain’s standing orders in their place, or says there are none yet', () => {
    const prompt = judgeSystemPrompt('STANDING ORDERS\nWhen a lead asks, say yes.\n');
    expect(prompt).toContain("learned from their past replies:\nSTANDING ORDERS\nWhen a lead asks, say yes.\n\n\nHow to speak:");
    expect(prompt).toContain('message: always the actual words you would send');
    expect(judgeSystemPrompt(undefined)).toContain('past replies:\nNone yet');
    expect(judgeSystemPrompt('  \n')).toContain('past replies:\nNone yet');
    expect(judgeVersion()).toMatch(/^judge-[0-9a-f]{8}$/);
    expect(prompt).toContain('- each ask\'s replies: buttons for the captain');
    expect(prompt).toContain('3 at most');
    expect(prompt).toContain(`${MAX_ASKS} at most`);
    expect(prompt).toContain('Spending money is always 3');
    expect(prompt).toContain('- each ask\'s ask: its headline');
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

  it('takes a verdict of the four routes, with its asks and the words it would send on any of them', () => {
    expect(parseVerdict({ route: 4, asks: [{ ask: ' Run the tests first ', replies: [] }], why: ' It can check. ', message: ' Run the tests. ' })).toEqual({ route: 4, asks: [{ ask: 'Run the tests first' }], why: 'It can check.', message: 'Run the tests.' });
    expect(parseVerdict({ route: 2, asks: [{ ask: 'Option A?', replies: [] }], why: 'A pick.', message: 'Shall it go ahead with option A?' })).toEqual({ route: 2, asks: [{ ask: 'Option A?' }], why: 'A pick.', message: 'Shall it go ahead with option A?' });
    // with no ask, its reason stands in
    expect(parseVerdict({ route: 1, why: 'Progress.' })).toEqual({ route: 1, asks: [{ ask: 'Progress.' }], why: 'Progress.', message: '' });
    expect(parseVerdict({ route: 1, asks: [{ ask: '  ' }], why: 'Progress.' })?.asks).toEqual([{ ask: 'Progress.' }]);
    expect(parseVerdict({ route: 5, why: 'x', message: '' })).toBeUndefined();
    // its reading for the captain, when it gives one
    expect(parseVerdict({ route: 1, why: 'Progress.', says: ' Okafor fixed the boot; nothing for you. ', message: '' })).toMatchObject({ says: 'Okafor fixed the boot; nothing for you.' });
    expect(parseVerdict({ route: 1, why: 'Progress.', says: '  ', message: '' })).not.toHaveProperty('says');
    expect(parseVerdict({ route: 1, why: '', message: '' })).toBeUndefined();
    expect(parseVerdict('1')).toBeUndefined();
  });

  it('takes several decisions as an ask each, with the replies that answer it alone, and keeps one alone where there is nothing to decide', () => {
    const asks = [
      { ask: 'Next slice: shared link or emails?', replies: [{ label: 'Shared link', text: 'Shared link first.' }, { label: 'Emails', text: 'Emails first.' }] },
      { ask: 'Keep the old endpoint for a release?', replies: [{ label: 'Keep it', text: 'Keep it for a release.' }] },
      { ask: ' Rename the setting? ', replies: [] },
    ];
    expect(parseVerdict({ route: 2, asks, why: 'Three calls.', message: 'm' })?.asks).toEqual([asks[0], asks[1], { ask: 'Rename the setting?' }]);
    expect(parseVerdict({ route: 3, asks: [...asks, ...asks], why: 'w', message: 'm' })?.asks).toHaveLength(MAX_ASKS);
    // routes 1 and 4 put nothing to the user: one ask, the first, says what it tells the lead
    expect(parseVerdict({ route: 1, asks, why: 'w', message: 'm' })?.asks).toEqual([asks[0]]);
    expect(VERDICT_SCHEMA.required).toContain('asks');
    expect(VERDICT_SCHEMA.required).not.toContain('ask');
    expect(VERDICT_SCHEMA.properties.asks.maxItems).toBe(MAX_ASKS);
  });

  it('takes an answer from before there were several asks, its one ask and its replies, as a list of one', () => {
    const replies = [{ label: 'Keep it open', text: 'Keep the goal open.' }];
    expect(parseVerdict({ route: 4, ask: ' Run the tests first ', why: 'It can check.', message: 'Run the tests.' })).toEqual({ route: 4, asks: [{ ask: 'Run the tests first' }], why: 'It can check.', message: 'Run the tests.' });
    expect(parseVerdict({ route: 2, ask: 'Close?', why: 'A pick.', message: 'm', replies })?.asks).toEqual([{ ask: 'Close?', replies }]);
  });

  it('takes the replies it suggests, each a label and the captain’s words, and none when it gives none', () => {
    const replies = [{ label: ' Keep it open ', text: ' Keep the goal open: there’s more. ' }, { label: 'Close it', text: 'Close it.' }, { label: 'Close it', text: 'Twice' }, { label: 'No words' }];
    expect(parseVerdict({ route: 2, asks: [{ ask: 'Close?', replies }], why: 'A pick.', message: 'm' })?.asks[0]?.replies).toEqual([{ label: 'Keep it open', text: 'Keep the goal open: there’s more.' }, { label: 'Close it', text: 'Close it.' }]);
    expect(parseVerdict({ route: 1, asks: [{ ask: 'Go on', replies: [] }], why: 'Progress.', message: '' })?.asks[0]).not.toHaveProperty('replies');
    expect(VERDICT_SCHEMA.properties.asks.items.required).toContain('replies');
  });

  it('asks for short labels and three replies at most, and drops a label too long for its button', () => {
    expect(judgeSystemPrompt()).toContain(`${MAX_REPLY_LABEL} characters at most`);
    expect(VERDICT_SCHEMA.properties.asks.items.properties.replies.maxItems).toBe(MAX_REPLIES);
    const replies = [{ label: 'Keep the goal open and start the settings page slice next', text: 'Keep it open.' }, { label: 'Close it', text: 'Close it.' }];
    expect(parseVerdict({ route: 2, asks: [{ ask: 'Close?', replies }], why: 'A pick.', message: 'm' })?.asks[0]?.replies).toEqual([{ label: 'Close it', text: 'Close it.' }]);
  });

  it('is told never to make an ask of merging a pull request the card has a merge button for', () => {
    expect(judgeSystemPrompt()).toContain("never an ask of merging a pull request listed under THE LEAD'S OPEN PULL REQUESTS");
  });
});

describe('the demo’s judge', () => {
  it('suggests replies fitted to the question it knows, yes or not yet otherwise', () => {
    expect(demoReplies('Keep the goal open, or close it?').map((r) => r.label)).toEqual(['Keep it open', 'Close it']);
    expect(demoReplies('Want me to redraw that part?').map((r) => r.label)).toEqual(['Yes, redraw it', 'No need']);
    expect(demoReplies('Shall I go ahead?').map((r) => r.label)).toEqual(['Go ahead', 'Not yet']);
  });

  it('makes an ask of each question in a turn that asks several, but a merge the card has a button for', () => {
    const prompt = `GOAL: Wishlist\n\nTHE LEAD'S OPEN PULL REQUESTS (the captain's card shows each with its merge button):\n- demo/api#1287\n\nThe end of what the lead said:\n<<<\nQA passed it. Shall I merge api#1287? Next slice: the shared link or the emails? And should we keep the old endpoint for a release?\n>>>`;
    expect(demoAsks(prompt)).toEqual([
      { ask: 'Next slice: the shared link or the emails?', replies: [{ label: 'Shared link', text: 'Shared link first.' }, { label: 'Emails', text: 'Emails first.' }] },
      { ask: 'Should we keep the old endpoint for a release?', replies: demoReplies('should we keep the old endpoint for a release?') },
    ]);
    expect(demoAsks('<<<\nShall I go ahead?\n>>>')).toEqual([]);
  });
});

describe('a route decided already', () => {
  it('tells Haiku the route and lets it give only that one', () => {
    expect(judgeSystemPrompt(undefined, 3)).toContain('The route is decided already: 3 (interrupt)');
    expect(judgeSystemPrompt(undefined)).not.toContain('decided already');
    expect(verdictSchema(4).properties.route.enum).toEqual([4]);
    expect(VERDICT_SCHEMA.properties.route.enum).toEqual([1, 2, 3, 4]);
  });

  it('keeps the asks that would move work on any route, and a move only when it’s whole', () => {
    const move = { what: 'the retry build', to: 'lead_b', brief: 'Retries are built.', pick: 'move' };
    const v = parseVerdict({ route: 1, why: 'w', message: 'm', asks: [{ ask: 'Carry on' }, { ask: 'Note it' }, { ask: 'Move the retry build?', move }, { ask: 'Move tests?', move: { ...move, pick: 'maybe' } }] });
    expect(v?.asks).toEqual([{ ask: 'Carry on' }, { ask: 'Move the retry build?', move }]);
    expect(VERDICT_SCHEMA.properties.asks.items.required).not.toContain('move');
  });
});
