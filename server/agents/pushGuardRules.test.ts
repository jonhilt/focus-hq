import { describe, expect, it } from 'vitest';
import { mergeDenial, pushDenial, refusedPushes } from './pushGuardRules';

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

describe('mergeDenial', () => {
  it('refuses merging or approving a pull request with gh, however it’s asked', () => {
    for (const command of [
      'gh pr merge 12 --squash',
      'cd web && gh pr merge --auto --squash 12',
      'gh pr review 12 --approve',
      'gh pr review 12 -a -b "looks good"',
      'gh api -X PUT repos/acme/web/pulls/12/merge',
      'gh api repos/acme/web/pulls/12/reviews -f event=APPROVE',
      `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }'`,
      `gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {pullRequestId: "x"}) { clientMutationId } }'`,
      // gh by its path, flags run together, and a field run into its flag
      '/opt/homebrew/bin/gh pr merge 12',
      'gh pr review 12 -ab "fine"',
      'gh pr review 12 -ca',
      'gh api repos/acme/web/pulls/12/reviews -fevent=APPROVE',
      'gh api repos/acme/web/pulls/12/reviews --field=event=APPROVE',
    ]) expect(mergeDenial(command), command).toMatch(/^Refused by Ops: only Ops or the user merges/);
  });

  it('lets everything else through: readying, commenting, reviewing without approving, and reading', () => {
    for (const command of [
      'gh pr ready 12',
      'gh pr create --draft --title "Merge the two lists"',
      'gh pr review 12 --comment -b "one question"',
      'gh pr review 12 --request-changes -b "see inline"',
      'gh pr view 12 --json mergeable,mergeStateStatus',
      'gh api repos/acme/web/pulls/12/reviews',
      'git merge origin/main',
      'echo "gh pr merge 12"',
      // a body that starts with a: the rest of -b's word is its value, not flags
      'gh pr review 12 -bapprove',
      'gh pr review 12 -c -b "approve once the test passes"',
    ]) expect(mergeDenial(command), command).toBeNull();
  });
});
