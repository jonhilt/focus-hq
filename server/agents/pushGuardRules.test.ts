import { describe, expect, it } from 'vitest';
import { pushDenial, refusedPushes } from './pushGuardRules';

describe('refusedPushes', () => {
  it('refuses every push once the goal is closing, and counts a branch merged in an earlier slice', () => {
    expect(refusedPushes({ closeStarted: { at: 1 }, repos: [{ baseBranch: 'main' }], prs: [], landed: [{ branch: 'fix/earlier', outcome: 'merged' }] })).toBe('closing\nbase main\nmerged fix/earlier\n');
  });
});

describe('pushDenial', () => {
  it('refuses a command that would skip the hooks', () => {
    expect(pushDenial('git push --no-verify origin fix/new')).toMatch(/^Refused by Ops/);
    expect(pushDenial('git -c core.hooksPath=/dev/null push origin fix/new')).toMatch(/^Refused by Ops/);
    expect(pushDenial('git push origin fix/new')).toBeNull();
    expect(pushDenial('git commit --no-verify -m wip')).toBeNull();
  });
});
