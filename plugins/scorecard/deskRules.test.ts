import { describe, expect, it } from 'vitest';
import { measureNewCommit } from './deskRules';
import type { Scorecard } from './types';

const card = (at: number): Pick<Scorecard, 'commit'> => ({ commit: `c${at}` });

describe('measureNewCommit', () => {
  it('measures a clean commit with no scorecard yet, the first one included', () => {
    expect(measureNewCommit([card(1)], { commit: 'c2', dirty: false })).toBe(true);
    expect(measureNewCommit([], { commit: 'c2', dirty: false })).toBe(true);
  });

  it('leaves a commit it measured already, and uncommitted work, alone', () => {
    expect(measureNewCommit([card(1), card(2)], { commit: 'c2', dirty: false })).toBe(false);
    expect(measureNewCommit([card(1)], { commit: 'c2', dirty: true })).toBe(false);
  });
});
