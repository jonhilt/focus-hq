import { describe, expect, it } from 'vitest';
import { arrive, DEFAULT_STEPS, readSteps, stepDone, stepLabel, stepPill, stepTick, type TrainingStep } from './trainingSteps';
import type { Agent } from './types';

const lead = (over: Record<string, unknown> = {}, rest: Partial<Agent> = {}): Agent =>
  ({ id: 'lead_1', task: 'lead', status: 'working', lead: { prs: [], questions: [], ...over }, ...rest }) as unknown as Agent;
const question = (answered: boolean) => ({ id: 'q1', question: 'Which?', options: [{ id: 'a', label: 'Cards with pictures' }, { id: 'b', label: 'A list' }], ...(answered && { answer: { option: 'a' } }) });

describe('readSteps', () => {
  it('reads kinds on their own and replies with what to say', () => {
    expect(readSteps(['start-goal', 'answer', { reply: ' Run a workflow ' }, 'approve', 'merge'])).toEqual([
      { do: 'start-goal' }, { do: 'answer' }, { do: 'reply', say: 'Run a workflow' }, { do: 'approve' }, { do: 'merge' },
    ]);
  });

  it('falls back to the default steps, and names a step it can’t read', () => {
    expect(readSteps(undefined)).toBe(DEFAULT_STEPS);
    expect(() => readSteps(['start-goal', 'dance'])).toThrow(/Step 2 is "dance"/);
    expect(() => readSteps(['reply'])).toThrow(/reply: what to say/);
  });
});

describe('stepLabel', () => {
  it('names the option it’ll pick and the request it’ll grant, once there’s one', () => {
    expect(stepLabel({ do: 'answer' }, lead({ questions: [question(false)] }))).toBe('Answer: Cards with pictures');
    expect(stepLabel({ do: 'answer' }, undefined)).toBe('Answer the lead’s question');
    expect(stepLabel({ do: 'approve' }, lead({}, { permission: { id: 'p', tool: 'ship', summary: 'Ship the slice' } as Agent['permission'] }))).toBe('Approve: Ship the slice');
    expect(stepLabel({ do: 'reply', say: 'Go' }, undefined)).toBe('Tell the lead: “Go”');
    const long = { id: 'p', tool: 'ship', summary: 'Ship the slice: Thin slice: Shoppers can save items for later', at: 0 };
    expect(stepLabel({ do: 'approve' }, lead({}, { permission: long }))).toBe('Approve: Ship the slice: Thin slice: Shoppers can save i…');
  });
});

describe('stepDone', () => {
  it('reads each step off the lead', () => {
    expect(stepDone({ do: 'start-goal' }, undefined)).toBe(false);
    expect(stepDone({ do: 'start-goal' }, lead())).toBe(true);
    expect(stepDone({ do: 'answer' }, lead({ questions: [question(false)] }))).toBe(false);
    expect(stepDone({ do: 'answer' }, lead({ questions: [question(true)] }))).toBe(true);
    expect(stepDone({ do: 'approve' }, lead({ prs: [{ repo: 'r', number: 1, url: '' }] }))).toBe(true);
    expect(stepDone({ do: 'merge' }, lead({ prs: [{ repo: 'r', number: 1, url: '' }] }))).toBe(false);
    expect(stepDone({ do: 'merge' }, lead({ prs: [], landed: [{ repo: 'r', number: 1, url: '', outcome: 'merged' }] }))).toBe(true);
    expect(stepDone({ do: 'reply', say: 'x' }, lead())).toBe(false);
  });
});

describe('stepping', () => {
  const steps: TrainingStep[] = DEFAULT_STEPS;

  it('moves on once the step is done, by ] or by hand', () => {
    const at = arrive(steps, 0, undefined);
    expect(stepTick(steps, at, undefined)).toBe(at);
    expect(stepTick(steps, at, lead({ questions: [question(false)] }))).toEqual({ index: 1, doneOnArrival: false });
  });

  it('waits for ] on a step that was done as the captain stepped back onto it', () => {
    const back = arrive(steps, 1, lead({ questions: [question(true)] }));
    expect(back).toEqual({ index: 1, doneOnArrival: true });
    expect(stepTick(steps, back, lead({ questions: [question(true)] }))).toBe(back);
  });

  it('says where the captain is, and when the steps are over', () => {
    expect(stepPill(steps, arrive(steps, 0, undefined), undefined)).toEqual({ where: '1 / 4', next: 'Start the goal at team station 1' });
    expect(stepPill(steps, arrive(steps, 9, undefined), undefined)).toEqual({ where: '4 / 4', next: 'All done' });
  });
});
