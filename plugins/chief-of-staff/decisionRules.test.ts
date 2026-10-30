import { describe, expect, it } from 'vitest';
import { aboutIt, actsLaidOut, askBlocksOf, actsOf, briefOf } from './decisionRules';

describe('a decision’s actions', () => {
  it('puts the chief of staff’s first suggested reply first on a lead’s turn, as the pick, the rest named beside it, with Got it', () => {
    const replies = [{ label: 'One link each', text: 'Go with one link each.' }, { label: 'Shared link', text: 'Use a shared link.' }];
    expect(actsOf({ kind: 'turn', replies, prs: 0 })).toEqual({
      go: { kind: 'reply', label: 'One link each', text: 'Go with one link each.' },
      others: [{ kind: 'reply', label: 'Shared link', text: 'Use a shared link.' }],
      ack: true,
      more: false,
    });
  });

  it('offers a turn with no suggested reply only Got it, and its open pull requests under More', () => {
    expect(actsOf({ kind: 'turn', prs: 2 })).toEqual({ others: [], ack: true, more: true });
  });

  it('allows a raised hand’s tool by name, or declines it', () => {
    expect(actsOf({ kind: 'hand', lead: 'l', permission: { id: 'r1', tool: 'Bash' }, prs: 1 })).toEqual({
      go: { kind: 'allow', label: 'Allow Bash', lead: 'l', request: 'r1' }, others: [{ kind: 'decline', label: 'Decline', lead: 'l', request: 'r1' }], ack: false, more: false,
    });
    expect(actsOf({ kind: 'hand', lead: 'l', prs: 0 }).go).toBeUndefined();
  });

  it('names a question’s options for what they are, never a letter, and puts none first', () => {
    const acts = actsOf({ kind: 'question', lead: 'l', question: { id: 'q1', options: [{ id: 'a', label: 'Below Sign' }, { id: 'b', label: 'Above Sign' }] }, prs: 0 });
    expect(acts.go).toBeUndefined();
    expect(acts.others).toEqual([{ kind: 'pick', label: 'Below Sign', lead: 'l', question: 'q1', option: 'a' }, { kind: 'pick', label: 'Above Sign', lead: 'l', question: 'q1', option: 'b' }]);
  });

  it('closes a goal that’s wrapped up, sends QA and conflicts to the pull requests, and leaves an error to Discuss', () => {
    expect(actsOf({ kind: 'wrap-up', prs: 1 }).go).toEqual({ kind: 'close-goal', label: 'Close the goal' });
    expect(actsOf({ kind: 'qa', prs: 0 }).go?.kind).toBe('prs');
    expect(actsOf({ kind: 'error', prs: 0 })).toEqual({ others: [], ack: false, more: false });
  });

  it('briefs the captain with the chief of staff’s words to them, not why it routed the turn', () => {
    const cos = { message: 'Three calls: 1. … Recommended: split them.', says: 'Okafor needs three calls.', why: 'It starts a new slice.' };
    expect(briefOf({ ...cos, route: 2 })).toBe('Three calls: 1. … Recommended: split them.');
    expect(briefOf({ ...cos, route: 3 })).toBe('Three calls: 1. … Recommended: split them.');
    expect(briefOf({ ...cos, route: 1 })).toBe('Okafor needs three calls.');
    expect(briefOf({ route: 4, message: 'Carry on.', why: 'Inside what you set.' })).toBe('Inside what you set.');
  });

  it('sends Discuss’s words after the decision they’re about', () => {
    expect(aboutIt('Filters first?', 'What about sorting?')).toBe('About “Filters first?”: What about sorting?');
  });
});

describe('a turn’s asks, a block each', () => {
  const asks = [
    { ask: 'Next slice: shared link or emails?', replies: [{ label: 'Shared link', text: 'Shared link first.' }, { label: 'Emails', text: 'Emails first.' }] },
    { ask: 'Keep the old endpoint for a release?' },
    { ask: 'Rename the setting?', replies: [{ label: 'Rename it', text: 'Rename it.' }] },
  ];

  it('gives each ask its own choices, marks the one held, and keeps the user’s own words as their answer', () => {
    const { blocks, answered, status } = askBlocksOf(asks, [{ ask: 0, text: 'Emails first.' }, { ask: 1, text: 'Keep it a release.' }], 'Vale');
    expect(blocks).toEqual([
      { index: 0, ask: asks[0]?.ask, choices: [{ kind: 'reply', label: 'Shared link', text: 'Shared link first.' }, { kind: 'reply', label: 'Emails', text: 'Emails first.' }], answer: 'Emails first.', picked: 'Emails' },
      { index: 1, ask: asks[1]?.ask, choices: [], answer: 'Keep it a release.' },
      { index: 2, ask: asks[2]?.ask, choices: [{ kind: 'reply', label: 'Rename it', text: 'Rename it.' }] },
    ]);
    expect(answered).toBe(2);
    expect(status).toBe('2 of 3 answered · nothing goes to Vale until all are, then they go together');
  });

  it('says they’re going together once every ask has an answer', () => {
    const all = asks.map((_, ask) => ({ ask, text: 'x' }));
    expect(askBlocksOf(asks, all, 'Vale').status).toBe('All 3 answered: sending them to Vale as one message');
  });
});

describe('work an ask would move to another goal', () => {
  const move = { what: 'the retry build', to: 'lead_b', brief: 'Built.', pick: 'move' as const };
  const keep = [{ label: 'Keep it here', text: 'Keep it here.' }];

  it('is a button of its own, the pick when the chief of staff picks moving it, its replies beside it', () => {
    expect(actsOf({ kind: 'turn', replies: keep, move, prs: 0 })).toMatchObject({ go: { kind: 'move', label: 'Move it', ask: 0 }, others: [{ kind: 'reply', label: 'Keep it here' }] });
    expect(actsOf({ kind: 'turn', replies: keep, move: { ...move, pick: 'keep' }, prs: 0 })).toMatchObject({ go: { kind: 'reply' }, others: [{ kind: 'move' }] });
    expect(actsOf({ kind: 'turn', move: { ...move, to: 'new' }, prs: 0 }).go).toEqual({ kind: 'move', label: 'Start a goal for it', ask: 0 });
  });

  it('leads the card when it’s the pick, the replies for keeping it under it', () => {
    const picked = actsLaidOut(actsOf({ kind: 'turn', replies: keep, move, prs: 0 }));
    expect(picked).toEqual({ moveFirst: { kind: 'move', label: 'Move it', ask: 0 }, choices: [{ kind: 'reply', label: 'Keep it here', text: 'Keep it here.' }], buttons: [] });
    expect(actsLaidOut(actsOf({ kind: 'turn', replies: keep, move: { ...move, pick: 'keep' }, prs: 0 }))).toEqual({ choices: [{ kind: 'reply', label: 'Keep it here', text: 'Keep it here.' }], buttons: [{ kind: 'move', label: 'Move it', ask: 0 }] });
  });

  it('has its button in its ask’s block on a turn of several', () => {
    const { blocks } = askBlocksOf([{ ask: 'Next slice?' }, { ask: 'Move the retry build?', replies: keep, move }], [], 'Rhee');
    expect(blocks[0]).not.toHaveProperty('move');
    expect(blocks[1]?.move).toEqual({ kind: 'move', label: 'Move it', ask: 1, pick: true });
  });
});
