import { describe, expect, it } from 'vitest';
import { asksForWorkflow, clampSpeed, nextSpeed, readScenario, scenarioParts, turnParts } from './scenarios';

describe('readScenario', () => {
  it('is full when the scene names none', () => {
    expect(readScenario(undefined)).toBe('full');
    expect(readScenario('')).toBe('full');
  });

  it('reads a scenario by name', () => {
    expect(readScenario('subagents')).toBe('subagents');
    expect(readScenario('workflow')).toBe('workflow');
  });

  it('names the scenarios there are when it is given another', () => {
    expect(() => readScenario('workflows')).toThrow(/"workflows": it's one of full, subagents, workflow/);
  });
});

describe('scenarioParts', () => {
  it('plays the whole story in full', () => {
    expect(scenarioParts('full')).toEqual({ leadTools: true, helpers: true, background: true, workflows: true });
  });

  it('keeps the subagents to helpers and the workflow to workflows', () => {
    expect(scenarioParts('subagents')).toMatchObject({ helpers: true, workflows: false, leadTools: false, background: false });
    expect(scenarioParts('workflow')).toMatchObject({ helpers: false, workflows: true, leadTools: false, background: false });
  });
});

describe('asking for a workflow', () => {
  it('hears it in the captain\'s own words', () => {
    expect(asksForWorkflow('Go ahead, and run a workflow to review it')).toBe(true);
    expect(asksForWorkflow('Use a workflow for the review')).toBe(true);
    expect(asksForWorkflow('ultracode: build it')).toBe(true);
  });

  it('leaves a mention of workflows alone', () => {
    expect(asksForWorkflow('How do workflows work?')).toBe(false);
    expect(asksForWorkflow('Go ahead')).toBe(false);
  });

  it('brings the workflows into any scenario\'s turn', () => {
    expect(turnParts('subagents', 'Go ahead and run a workflow')).toMatchObject({ helpers: true, workflows: true });
    expect(turnParts('subagents', 'Go ahead')).toMatchObject({ helpers: true, workflows: false });
  });
});

describe('training pace', () => {
  it('steps slower and faster along the ladder, from a rung or between them', () => {
    expect(nextSpeed(0.5, -1)).toBe(0.25);
    expect(nextSpeed(0.5, 1)).toBe(0.75);
    expect(nextSpeed(0.6, -1)).toBe(0.5);
    expect(nextSpeed(0.6, 1)).toBe(0.75);
  });

  it('stops at the ends, and keeps an asked-for pace in range', () => {
    expect(nextSpeed(0.1, -1)).toBe(0.1);
    expect(nextSpeed(3, 1)).toBe(3);
    expect(clampSpeed(0.01)).toBe(0.1);
    expect(clampSpeed(9)).toBe(3);
    expect(clampSpeed('fast')).toBe(1);
  });
});
