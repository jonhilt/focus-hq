import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { MergeHeads, MergeTrial } from '../../shared/mergeCheck';
import { demoLayer } from '../github/demo';
import { GitHub } from '../github/service';
import { Hub } from '../hub';
import { demoWorkspace } from './demoRunner';
import { office } from './fakeOffice';
import type { WorkspaceOps } from './types';

// The merge check through the office (docs/merging.md): the demo GitHub, and a workspace whose trial of the merge the test decides.

const REPO = 'demo/webshop-frontend';

/** A fake office whose GitHub the test can read, and whose merge checks come out as `outcome` says: each trial counted. */
async function gated(outcome: (heads: MergeHeads) => MergeTrial, hold?: Promise<void>) {
  const gh = await ManagedRuntime.make(demoLayer).runPromise(GitHub.use(Effect.succeed));
  let base = 'base0000aaa';
  const trials: MergeHeads[] = [];
  const workspace: WorkspaceOps = {
    ...demoWorkspace,
    mergeHeads: async () => ({ base, head: '' }),
    tryMerge: async (_repo, heads) => {
      trials.push(heads);
      await hold;
      return outcome(heads);
    },
  };
  const o = office(workspace, Layer.succeed(GitHub, gh));
  const prs = await Effect.runPromise(gh.listPullRequests(REPO));
  const pr = prs.find((p) => p.author === 'demo-manager');
  if (!pr) throw new Error('the demo has no PR of the office’s');
  o.store.boards.set(o.project.id, { projectId: o.project.id, issues: [], prs, updatedAt: 0 });
  const state = () => Effect.runPromise(gh.pullRequestState(REPO, pr.number));
  const comments = () => Effect.runPromise(gh.pullRequestComments(REPO, pr.number));
  const checks = () => o.store.ledger.filter((e) => e.kind === 'merge-check');
  return { ...o, pr, prs, trials, state, comments, checks, moveBase: (to: string) => (base = to) };
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
