import { describe, expect, it } from 'vitest';
import { aboutIt, actsOf } from './decisionRules';

describe('a decision’s actions', () => {
  it('makes the chief of staff’s first suggested reply so on a lead’s turn, the rest named beside it, with Got it', () => {
    const replies = [{ label: 'One link each', text: 'Go with one link each.' }, { label: 'Shared link', text: 'Use a shared link.' }];
    expect(actsOf({ kind: 'turn', replies, prs: 0 })).toEqual({
      go: { kind: 'reply', label: 'Make it so', text: 'Go with one link each.' },
      pick: 'One link each',
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

  it('sends Discuss’s words after the decision they’re about', () => {
    expect(aboutIt('Filters first?', 'What about sorting?')).toBe('About “Filters first?”: What about sorting?');
  });
});
