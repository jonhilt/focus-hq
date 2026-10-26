import { describe, expect, it } from 'vitest';
import { CommandError } from '../util';
import { heldMessage, parseWorktrees, retryLockRace, reviewCheckoutId, reviewRepoId, trashName } from './worktrees';
import { orphanedWorkspaces } from './worktreeRules';

const porcelain = `worktree /data/repos/acme__shop
HEAD aca864f97ead8ad492cb364ebc49dfa3cbe1de51
branch refs/heads/main

worktree /data/workspaces/agent_d86247eeb5
HEAD aca864f97ead8ad492cb364ebc49dfa3cbe1de51
branch refs/heads/focus/70-replace-desks-eeb5

worktree /data/previews/acme__shop
HEAD aca864f97ead8ad492cb364ebc49dfa3cbe1de51
detached

worktree /data/workspaces/agent_gone
HEAD aca864f97ead8ad492cb364ebc49dfa3cbe1de51
branch refs/heads/focus/12-old
prunable gitdir file points to non-existent location
`;

describe('parseWorktrees', () => {
  it('reads each worktree with its short branch name, leaving detached ones without one', () => {
    expect(parseWorktrees(porcelain)).toEqual([
      { path: '/data/repos/acme__shop', branch: 'main' },
      { path: '/data/workspaces/agent_d86247eeb5', branch: 'focus/70-replace-desks-eeb5' },
      { path: '/data/previews/acme__shop', branch: undefined },
      { path: '/data/workspaces/agent_gone', branch: 'focus/12-old' },
    ]);
  });

  it('copes with an empty list', () => {
    expect(parseWorktrees('')).toEqual([]);
  });
});

describe('heldMessage', () => {
  it("names the colleague's workspace", () => {
    expect(heldMessage('focus/70-x', { path: '/data/workspaces/agent_a', agentId: 'agent_a' })).toBe(
      "Branch focus/70-x is checked out in /data/workspaces/agent_a, the workspace of agent_a, who's still aboard.",
    );
  });
});

describe('retryLockRace', () => {
  const lockRace = new CommandError('git fetch origin --prune failed', "error: cannot lock ref 'refs/remotes/origin/main'", 1);
  const network = new CommandError('git fetch origin --prune failed', 'fatal: Could not resolve host: github.com', 128);
  const failing = (...errors: Error[]) => {
    let calls = 0;
    const fetch = () => {
      calls++;
      const err = errors.shift();
      return err ? Promise.reject(err) : Promise.resolve('fetched');
    };
    return { fetch, calls: () => calls };
  };
  const noWait = () => Promise.resolve();

  it('gets past a lock race that clears up', async () => {
    const f = failing(lockRace);
    await expect(retryLockRace(f.fetch, noWait)).resolves.toBe('fetched');
    expect(f.calls()).toBe(2);
  });

  it('gives up with the git error after a bounded number of attempts', async () => {
    const f = failing(lockRace, lockRace, lockRace, lockRace);
    await expect(retryLockRace(f.fetch, noWait)).rejects.toBe(lockRace);
    expect(f.calls()).toBe(3);
  });

  it('fails other errors on the first attempt', async () => {
    const f = failing(network);
    await expect(retryLockRace(f.fetch, noWait)).rejects.toBe(network);
    expect(f.calls()).toBe(1);
  });
});

describe('a reviewer’s checkouts', () => {
  it('keeps one folder per pull request inside the reviewer’s workspace, so two repos’ PRs never share one', () => {
    expect(reviewCheckoutId('qa_lead_p1_ab', 'acme/api', 7)).toBe('qa_lead_p1_ab/acme__api-pr7');
    expect(reviewCheckoutId('qa_lead_p1_ab', 'acme/web', 7)).not.toBe(reviewCheckoutId('qa_lead_p1_ab', 'acme/api', 7));
  });

  it('lays a review’s folder out like the lead’s workspace, each repo in its own folder', () => {
    const pr = { repo: 'acme/api', number: 7 };
    expect(reviewRepoId('qa_lead_p1_ab', pr, 'api')).toBe('qa_lead_p1_ab/acme__api-pr7/api');
    expect(reviewRepoId('qa_lead_p1_ab', pr, 'web')).toBe('qa_lead_p1_ab/acme__api-pr7/web');
  });

  it('moves a folder that won’t delete to one the sweep owns no one for', () => {
    const name = trashName('/data/workspaces/qa_lead_p1_ab/acme__api-pr7', 'c0ffee');
    expect(name).toBe('trash_acme__api-pr7_c0ffee');
    expect(orphanedWorkspaces([name, 'qa_lead_p1_ab'], ['qa_lead_p1_ab'], [])).toEqual([name]);
  });
});
