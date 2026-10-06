import { describe, expect, it } from 'vitest';
import { CommandError } from '../util';
import { claimBranch, heldMessage, isRefLockRace, orphanedWorkspaces, parseWorktrees, retryLockRace } from './worktrees';

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

describe('claimBranch', () => {
  const worktrees = parseWorktrees(porcelain);
  const nobody = () => false;

  it('is free when no worktree has the branch', () => {
    expect(claimBranch(worktrees, 'focus/99-new', '/data/workspaces', nobody)).toEqual({ kind: 'free' });
  });

  it('reclaims a workspace whose agent has left the office', () => {
    expect(claimBranch(worktrees, 'focus/70-replace-desks-eeb5', '/data/workspaces', nobody)).toEqual({
      kind: 'reclaim',
      path: '/data/workspaces/agent_d86247eeb5',
    });
  });

  it("leaves a colleague's workspace alone", () => {
    const inOffice = (id: string) => id === 'agent_d86247eeb5';
    expect(claimBranch(worktrees, 'focus/70-replace-desks-eeb5', '/data/workspaces', inOffice)).toEqual({
      kind: 'held',
      path: '/data/workspaces/agent_d86247eeb5',
      agentId: 'agent_d86247eeb5',
    });
  });

  it('never reclaims a folder outside the workspaces', () => {
    expect(claimBranch(worktrees, 'main', '/data/workspaces', nobody)).toEqual({ kind: 'held', path: '/data/repos/acme__shop' });
  });

  it('never reclaims a folder nested inside a workspace, or a sibling with a similar name', () => {
    const odd = [
      { path: '/data/workspaces/agent_a/sub', branch: 'b1' },
      { path: '/data/workspaces-old/agent_b', branch: 'b2' },
    ];
    expect(claimBranch(odd, 'b1', '/data/workspaces', nobody).kind).toBe('held');
    expect(claimBranch(odd, 'b2', '/data/workspaces', nobody).kind).toBe('held');
  });

  it("reclaims a repo's folder in the workspace of a lead who has gone, and leaves a working lead's alone", () => {
    const leads = [{ path: '/data/workspaces/lead_p1_ab12/web', branch: 'focus/saved-items-1-cd34' }];
    expect(claimBranch(leads, 'focus/saved-items-1-cd34', '/data/workspaces', nobody)).toEqual({ kind: 'reclaim', path: '/data/workspaces/lead_p1_ab12/web' });
    expect(claimBranch(leads, 'focus/saved-items-1-cd34', '/data/workspaces', (id) => id === 'lead_p1_ab12')).toEqual({
      kind: 'held',
      path: '/data/workspaces/lead_p1_ab12/web',
      agentId: 'lead_p1_ab12',
    });
    expect(claimBranch([{ path: '/data/workspaces/lead_p1_ab12/web/deeper', branch: 'x' }], 'x', '/data/workspaces', nobody).kind).toBe('held');
  });
});

describe('heldMessage', () => {
  it("names the colleague's workspace", () => {
    expect(heldMessage('focus/70-x', { path: '/data/workspaces/agent_a', agentId: 'agent_a' })).toBe(
      "Branch focus/70-x is checked out in /data/workspaces/agent_a, the workspace of agent_a, who's still in the office.",
    );
  });
});

describe('isRefLockRace', () => {
  it('spots a lost race for a remote-tracking ref', () => {
    const stderr = `error: cannot lock ref 'refs/remotes/origin/main': is at 7fdca47 but expected 2480528
 ! 2480528..7fdca47  main -> origin/main  (unable to update local ref)`;
    expect(isRefLockRace(stderr)).toBe(true);
  });

  it('lets network and auth failures through', () => {
    expect(isRefLockRace('fatal: unable to access \'https://github.com/acme/shop/\': Could not resolve host: github.com')).toBe(false);
    expect(isRefLockRace('remote: Repository not found.\nfatal: Authentication failed')).toBe(false);
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

describe('orphanedWorkspaces', () => {
  it("picks the folders that belong to no agent in the office and no project's triage", () => {
    const folders = ['agent_786fa4665d', 'agent_d86247eeb5', 'qa_p1', 'triage_p1', 'triage_p_gone'];
    const agents = ['agent_d86247eeb5', 'qa_p1'];
    expect(orphanedWorkspaces(folders, agents, ['p1'])).toEqual(['agent_786fa4665d', 'triage_p_gone']);
  });

  it('keeps everything when every folder has an owner', () => {
    expect(orphanedWorkspaces(['agent_a', 'triage_p1'], ['agent_a'], ['p1'])).toEqual([]);
  });
});
