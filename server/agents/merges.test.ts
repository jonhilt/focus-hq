import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { MergeHeads, MergeTrial } from '../../shared/mergeCheckRules';
import { demoLayer } from '../github/demo';
import { GitHub } from '../github/service';
import { Hub } from '../hub';
import { demoWorkspace } from './demoRunner';
import { focus } from './fakeFocus';
import type { WorkspaceOps } from './types';

// The merge check through Ops (docs/merging.md): the demo GitHub, and a workspace whose trial of the merge the test decides.

const REPO = 'demo/webshop-frontend';

/** A fake Focus whose GitHub the test can read, and whose merge checks come out as `outcome` says: each trial counted. */
async function gated(outcome: (heads: MergeHeads) => MergeTrial, hold?: Promise<void>) {
  const gh = await ManagedRuntime.make(demoLayer).runPromise(GitHub.use(Effect.succeed));
  let base = 'base0000aaa';
  const trials: MergeHeads[] = [];
  let fetches = 0;
  const workspace: WorkspaceOps = {
    ...demoWorkspace,
    mergeHeads: async () => {
      fetches++;
      return { base, head: '' };
    },
    tryMerge: async (_repo, heads) => {
      trials.push(heads);
      await hold;
      return outcome(heads);
    },
  };
  const o = focus(workspace, Layer.succeed(GitHub, gh));
  const prs = await Effect.runPromise(gh.listPullRequests(REPO));
  const pr = prs.find((p) => p.author === 'demo-manager');
  if (!pr) throw new Error('the demo has no PR of Ops’');
  o.store.boards.set(o.project.id, { projectId: o.project.id, issues: [], prs, updatedAt: 0 });
  const state = () => Effect.runPromise(gh.pullRequestState(REPO, pr.number));
  const comments = () => Effect.runPromise(gh.pullRequestComments(REPO, pr.number));
  const checks = () => o.store.ledger.filter((e) => e.kind === 'merge-check');
  return { ...o, gh, pr, prs, trials, state, comments, checks, fetches: () => fetches, moveBase: (to: string) => (base = to) };
}

const lintFails = (heads: MergeHeads): MergeTrial => ({
  kind: 'checked',
  ...heads,
  merge: 'merge000111',
  results: [{ command: 'pnpm run typecheck', ok: true }, { command: 'pnpm run lint', ok: false, output: 'no-unused-vars' }],
});
const allPass = (heads: MergeHeads): MergeTrial => ({ kind: 'checked', ...heads, merge: 'merge000222', results: [{ command: 'pnpm test', ok: true }] });

describe('the merge check', () => {
  it('refuses a merge whose result fails a check: the PR stays open, says why, and the ledger has it', async () => {
    const { agents, project, pr, state, comments, checks } = await gated(lintFails);
    await expect(agents.merge(project.id, pr, { method: 'squash', by: 'captain' })).rejects.toThrow('`pnpm run lint` fails on its merge with the base at base000');
    expect(await state()).toBe('OPEN');
    expect(checks()).toMatchObject([{ outcome: 'failed', failed: 'pnpm run lint', by: 'captain', base: 'base0000aaa', head: pr.headSha }]);
    expect(agents.mergeCheck(pr)).toMatchObject({ state: 'refused' });
    await expect.poll(comments).toEqual([expect.stringContaining('Merge check: refused')]);
  });

  it('merges one whose result passes, at the commit it checked', async () => {
    const { agents, project, pr, state, checks, trials } = await gated(allPass);
    await expect(agents.merge(project.id, pr, { method: 'squash', by: 'office', want: pr.headSha })).resolves.toBe(pr.headSha);
    expect(await state()).toBe('MERGED');
    expect(trials).toEqual([{ base: 'base0000aaa', head: pr.headSha }]);
    expect(checks()).toMatchObject([{ outcome: 'passed', by: 'office' }]);
  });

  it('doesn’t run the checks again for the same base and head, but does once the base moves', async () => {
    const { agents, project, pr, trials, moveBase } = await gated(lintFails);
    const merge = () => agents.merge(project.id, pr, { method: 'squash', by: 'captain' });
    await expect(merge()).rejects.toThrow('lint');
    await expect(merge()).rejects.toThrow('lint');
    expect(trials).toHaveLength(1);
    moveBase('base1111bbb');
    await expect(merge()).rejects.toThrow('base at base111');
    expect(trials).toHaveLength(2);
  });

  it('refuses a conflicting merge', async () => {
    const { agents, project, pr, state } = await gated((heads) => ({ kind: 'conflicts', ...heads, files: ['src/header.ts'] }));
    await expect(agents.merge(project.id, pr, { method: 'squash', by: 'office' })).rejects.toThrow('it conflicts with its base at base000 (src/header.ts)');
    expect(await state()).toBe('OPEN');
  });

  it('refuses a PR that moved on from the commit QA passed, without checking it', async () => {
    const { agents, project, pr, trials } = await gated(allPass);
    await expect(agents.merge(project.id, pr, { method: 'squash', by: 'captain', want: 'fffffff000' })).rejects.toThrow('it moved on');
    expect(trials).toHaveLength(0);
  });

  it('merges past a refusal when the captain says so, and the ledger notes the override', async () => {
    const { agents, project, pr, state, checks } = await gated(lintFails);
    await expect(agents.merge(project.id, pr, { method: 'squash', by: 'captain' })).rejects.toThrow('lint');
    await agents.merge(project.id, pr, { method: 'squash', by: 'captain', override: true, want: pr.headSha });
    expect(await state()).toBe('MERGED');
    expect(checks().map((e) => e.kind === 'merge-check' && e.outcome)).toEqual(['failed', 'overridden']);
  });

  it('shows a merge waiting behind another in the same repo as queued straight away, then checking once its turn comes', async () => {
    let release = () => {};
    const { agents, project, pr, prs, store, trials } = await gated(allPass, new Promise<void>((r) => (release = r)));
    const other = prs.find((p) => p.number !== pr.number);
    if (!other) throw new Error('the demo repo has only one PR');
    const toasts = vi.spyOn(Hub.prototype, 'toast');
    // what the board showed of the second PR, as each send went out
    const shown: (string | undefined)[] = [];
    const sent = vi.spyOn(Hub.prototype, 'send').mockImplementation((e) => {
      if (e.type === 'board') shown.push(e.board.prs.find((p) => p.number === other.number)?.mergeCheck?.state);
    });
    const card = (n: number) => store.boards.get(project.id)?.prs.find((p) => p.number === n)?.mergeCheck;
    const first = agents.merge(project.id, pr, { method: 'squash', by: 'captain' });
    await expect.poll(() => card(pr.number)?.state).toBe('checking');
    const second = agents.merge(project.id, other, { method: 'squash', by: 'captain' });
    expect(card(other.number)).toEqual({ state: 'queued', head: other.headSha, behind: pr.number });
    expect(toasts).toHaveBeenCalledWith('info', expect.stringContaining(`#${other.number} is queued behind #${pr.number}`), undefined, project.id);
    expect(trials).toHaveLength(1);
    release();
    await Promise.all([first, second]);
    expect(shown.filter((s, i) => s && s !== shown[i - 1])).toEqual(['queued', 'checking', 'passed']);
    expect(trials).toHaveLength(2);
    toasts.mockRestore();
    sent.mockRestore();
  });
});

describe('with the merge check switched off for the project', () => {
  it('merges straight away at the head the caller means, with no fetch or trial, and the ledger notes it went unchecked', async () => {
    const { agents, project, pr, state, checks, trials, fetches } = await gated(lintFails);
    project.checkMerges = false;
    await expect(agents.merge(project.id, pr, { method: 'squash', by: 'office', want: pr.headSha })).resolves.toBe(pr.headSha);
    expect(await state()).toBe('MERGED');
    expect(fetches()).toBe(0);
    expect(trials).toHaveLength(0);
    expect(checks()).toMatchObject([{ outcome: 'unchecked', by: 'office', head: pr.headSha }]);
    expect(agents.mergeCheck(pr)).toBeUndefined();
  });

  it('asks GitHub for exactly the commit the caller means, so a PR that moved on isn’t merged', async () => {
    const { agents, project, pr, state, gh } = await gated(allPass);
    project.checkMerges = false;
    const merged = vi.spyOn(gh, 'mergePullRequest');
    await expect(agents.merge(project.id, pr, { method: 'squash', by: 'captain', want: 'fffffff000' })).rejects.toThrow('GitHub refused it');
    expect(merged).toHaveBeenCalledWith(REPO, pr.number, 'squash', 'fffffff000');
    expect(await state()).toBe('OPEN');
  });

  it('merges a PR asked for twice at once only once', async () => {
    const { agents, project, pr, gh, checks } = await gated(allPass);
    project.checkMerges = false;
    const merged = vi.spyOn(gh, 'mergePullRequest');
    const how = { method: 'squash', by: 'office', want: pr.headSha } as const;
    await expect(Promise.all([agents.merge(project.id, pr, how), agents.merge(project.id, pr, how)])).resolves.toEqual([pr.headSha, pr.headSha]);
    expect(merged).toHaveBeenCalledTimes(1);
    expect(checks()).toHaveLength(1);
  });

  it('doesn’t wait behind a checked merge under way in the same repo, or show as queued', async () => {
    let release = () => {};
    const { agents, project, pr, prs, store, state, trials } = await gated(allPass, new Promise<void>((r) => (release = r)));
    const other = prs.find((p) => p.number !== pr.number);
    if (!other) throw new Error('the demo repo has only one PR');
    const toasts = vi.spyOn(Hub.prototype, 'toast');
    const card = (n: number) => store.boards.get(project.id)?.prs.find((p) => p.number === n)?.mergeCheck;
    const first = agents.merge(project.id, pr, { method: 'squash', by: 'captain' });
    await expect.poll(() => card(pr.number)?.state).toBe('checking');
    // switched off while that one is being checked: it finishes as it started, the next skips the check
    project.checkMerges = false;
    await expect(agents.merge(project.id, other, { method: 'squash', by: 'captain' })).resolves.toBe(other.headSha);
    expect(card(other.number)).toBeUndefined();
    expect(toasts).not.toHaveBeenCalledWith('info', expect.stringContaining('queued behind'), undefined, project.id);
    expect(await state()).toBe('OPEN');
    release();
    await first;
    expect(await state()).toBe('MERGED');
    expect(trials).toHaveLength(1);
    toasts.mockRestore();
  });

  it('checks merges again once it’s switched back on', async () => {
    const { agents, project, pr, prs, trials, state, checks } = await gated(lintFails);
    const other = prs.find((p) => p.number !== pr.number);
    if (!other) throw new Error('the demo repo has only one PR');
    project.checkMerges = false;
    await agents.merge(project.id, other, { method: 'squash', by: 'captain' });
    project.checkMerges = true;
    await expect(agents.merge(project.id, pr, { method: 'squash', by: 'captain' })).rejects.toThrow('lint');
    expect(trials).toHaveLength(1);
    expect(await state()).toBe('OPEN');
    expect(checks().map((e) => e.kind === 'merge-check' && e.outcome)).toEqual(['unchecked', 'failed']);
  });
});
