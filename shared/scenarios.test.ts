import { describe, expect, it } from 'vitest';
import { readScenario, scenarioParts } from './scenarios';

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
    expect(scenarioParts('full')).toEqual({ explain: true, helpers: true, background: true, workflows: true });
  });

  it('keeps the subagents to helpers and the workflow to workflows', () => {
    expect(scenarioParts('subagents')).toMatchObject({ helpers: true, workflows: false, explain: false, background: false });
    expect(scenarioParts('workflow')).toMatchObject({ helpers: false, workflows: true, explain: false, background: false });
  });
});
