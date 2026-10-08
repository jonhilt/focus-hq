import { describe, expect, it } from 'vitest';
import { conflictsAgentModel } from './conflicts';

describe('conflictsAgentModel', () => {
  it('falls back to the office model when no conflicts model is set', () => {
    expect(conflictsAgentModel({ model: 'claude-opus-5-5', conflictsModel: '' })).toEqual({ model: 'claude-opus-5-5', effort: undefined });
  });

  it('prefers the conflicts model', () => {
    expect(conflictsAgentModel({ model: 'claude-opus-5-5', conflictsModel: 'claude-sonnet-5-5' }).model).toBe('claude-sonnet-5-5');
  });

  it("leaves the model to Claude Code's default when neither is set", () => {
    expect(conflictsAgentModel({ model: '', conflictsModel: '' }).model).toBeUndefined();
  });

  it('passes the conflicts effort through, or leaves it undefined', () => {
    expect(conflictsAgentModel({ model: '', conflictsModel: '', conflictsEffort: 'low' }).effort).toBe('low');
    expect(conflictsAgentModel({ model: '', conflictsModel: '' }).effort).toBeUndefined();
  });
});
