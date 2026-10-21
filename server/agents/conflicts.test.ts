import { describe, expect, it } from 'vitest';
import { autoMergePlan, conflictsAgentModel, conflictsRecord, conflictStages, mergeRules } from './conflicts';

describe('conflictsAgentModel', () => {
  it('falls back to Focus’s model when no conflicts model is set', () => {
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

describe('settling conflicts by rule', () => {
  const lsFiles = [
    '100644 aaaa 1\tCLAUDE.md',
    '100644 bbbb 2\tCLAUDE.md',
    '100644 cccc 3\tCLAUDE.md',
    '100644 dddd 2\tclient/public/ship/holodeck-deck.glb',
    '100644 eeee 3\tclient/public/ship/holodeck-deck.glb',
    '100644 ffff 1\tsrc/header.ts',
    '100644 abab 2\tsrc/header.ts',
    '100644 cdcd 3\tsrc/header.ts',
    '',
  ].join('\0');

  it('reads the stages git left each conflicted file at', () => {
    const stages = conflictStages(lsFiles);
    expect([...stages.keys()]).toEqual(['CLAUDE.md', 'client/public/ship/holodeck-deck.glb', 'src/header.ts']);
    expect([...stages.get('client/public/ship/holodeck-deck.glb')!]).toEqual([2, 3]);
  });

  it('reads each file’s rule from .gitattributes, git’s own merge=union counting as union', () => {
    const attrs = [
      'CLAUDE.md', 'focus-merge', 'unspecified', 'CLAUDE.md', 'merge', 'union',
      'notes.md', 'focus-merge', 'union', 'notes.md', 'merge', 'unspecified',
      'deck.glb', 'focus-merge', 'theirs', 'deck.glb', 'merge', 'binary',
      'src/header.ts', 'focus-merge', 'unspecified', 'src/header.ts', 'merge', 'unspecified',
      'odd.txt', 'focus-merge', 'whatever', 'odd.txt', 'merge', 'unspecified',
      '',
    ].join('\0');
    expect(mergeRules(attrs)).toEqual(new Map([['CLAUDE.md', 'union'], ['notes.md', 'union'], ['deck.glb', 'theirs']]));
  });

  it('settles the files with a rule, and leaves the rest for an agent', () => {
    const rules = new Map([['CLAUDE.md', 'union'], ['client/public/ship/holodeck-deck.glb', 'theirs']] as const);
    expect(autoMergePlan(conflictStages(lsFiles), new Map(rules))).toEqual({
      auto: [{ file: 'CLAUDE.md', rule: 'union' }, { file: 'client/public/ship/holodeck-deck.glb', rule: 'theirs' }],
      left: ['src/header.ts'],
    });
  });

  it('won’t union a file one side deleted, but takes a side even when that side deleted it', () => {
    const stages = new Map([['notes.md', new Set([1, 2])], ['deck.glb', new Set([1, 2])]]);
    expect(autoMergePlan(stages, new Map([['notes.md', 'union'], ['deck.glb', 'theirs']]))).toEqual({ auto: [{ file: 'deck.glb', rule: 'theirs' }], left: ['notes.md'] });
  });
});

describe('the ledger’s conflicts line', () => {
  it('says Ops settled it by rule, with the files', () => {
    expect(conflictsRecord({ kind: 'merged', sha: 'b', from: 'a', auto: ['CLAUDE.md'] })).toEqual({ resolved: 'auto', files: ['CLAUDE.md'] });
  });

  it('says git merged it by itself', () => {
    expect(conflictsRecord({ kind: 'merged', sha: 'b', from: 'a' })).toEqual({ resolved: 'office' });
    expect(conflictsRecord({ kind: 'up-to-date' })).toEqual({ resolved: 'up-to-date' });
  });

  it('lists the files an agent has to resolve, and the check a clean merge broke', () => {
    expect(conflictsRecord({ kind: 'conflicts', files: ['src/header.ts', 'CLAUDE.md'] })).toEqual({ resolved: 'agent', files: ['src/header.ts', 'CLAUDE.md'] });
    expect(conflictsRecord({ kind: 'conflicts', files: [], broke: 'npm run typecheck' })).toEqual({ resolved: 'agent', broke: 'npm run typecheck' });
  });
});
