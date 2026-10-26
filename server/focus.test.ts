import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { MergeHeads, MergeTrial } from '../shared/mergeCheckRules';
import { prKey } from '../shared/qa';
import type { PullRequest, QaReview } from '../shared/types';
import { DemoDrafter, demoWorkspace } from './agents/demoRunner';
import { focus as fakeFocus } from './agents/fakeFocus';
import { IssuePlanner } from './agents/planner';
import type { WorkspaceOps } from './agents/types';
import { demoLayer } from './github/demo';
import { GitHub, toProvider } from './github/service';
import { Hub } from './hub';
import { Focus } from './focus';
import { Previews } from './previews';
import { Voice } from './voice';

// What a board refresh does with each PR on its way to merged (docs/merging.md, docs/qa.md): auto-merge following
// `mergeStep`, and the captain's "Merge when QA passes" following `requestedMerge`. The decisions are tested in
// shared/mergeGateRules.test.ts; these hold Ops to carrying them out, on the demo GitHub and the fake crew.

const REPO = 'demo/webshop-frontend';
/** One of Ops' demo PRs in REPO, open and passing. */
const NUMBER = 8;
const RUN = 9001;

const allPass = (heads: MergeHeads): MergeTrial => ({ kind: 'checked', ...heads, merge: 'merge000222', results: [{ command: 'pnpm test', ok: true }] });
const lintFails = (heads: MergeHeads): MergeTrial => ({
  kind: 'checked',
  ...heads,
  merge: 'merge000111',
  results: [{ command: 'pnpm run lint', ok: false, output: 'no-unused-vars' }],
});

/**
 * A real Focus on the demo GitHub, whose PR #8 in REPO GitHub lists as `listed` says, and whose merge checks come out
 * as `trial` says. Its toasts, merge trials and checks re-run are kept for the test to read.
 */
async function room(listed: Partial<PullRequest> = {}, trial: (heads: MergeHeads) => MergeTrial = allPass) {
  const gh = await ManagedRuntime.make(demoLayer).runPromise(GitHub.use(Effect.succeed));
  const reruns: number[][] = [];
  let rerun: Effect.Effect<void> = Effect.void;
  const github = Layer.succeed(GitHub, GitHub.of({
    ...gh,
    listPullRequests: (repo) => gh.listPullRequests(repo).pipe(Effect.map((prs) => prs.map((p) => (p.repo === REPO && p.number === NUMBER ? { ...p, ...listed } : p)))),
    rerunFailedRuns: (_repo, runIds) => Effect.andThen(rerun, Effect.sync(() => void reruns.push(runIds))),
  }));
  const trials: MergeHeads[] = [];
  const workspace: WorkspaceOps = {
    ...demoWorkspace,
    mergeHeads: async () => ({ base: 'base0000aaa', head: '' }),
    tryMerge: async (_repo, heads) => {
      trials.push(heads);
      return trial(heads);
    },
  };
  const o = fakeFocus(workspace, github);
  const hub = new Hub();
  const toasts = vi.spyOn(hub, 'toast');
  const provider = toProvider(github);
  const focus = new Focus(o.store, hub, provider, new Previews(hub, provider, true), new IssuePlanner(o.store, hub, new DemoDrafter()), new Voice(hub, true), 'test');
  focus.agents = o.agents;
  const head = (await Effect.runPromise(gh.getPullRequest(REPO, NUMBER))).headSha ?? '';
  /** QA's review of #8, as if it had finished: passed at its head unless `at` another commit. */
  const reviewed = (review: Partial<QaReview> = {}) =>
    o.store.reviewJournal(prKey(REPO, NUMBER), {
      kind: 'imported',
      review: { projectId: o.project.id, repo: REPO, number: NUMBER, title: 'Wishlist page', status: 'passed', sha: head, openedByOffice: true, report: { verdict: 'pass', summary: 'Works.', checks: [], commands: [], captions: [] }, requestedAt: 1, finishedAt: 2, ...review },
    });
  const said = (level: 'info' | 'success' | 'error') => toasts.mock.calls.filter(([l]) => l === level).map(([, text]) => text);
  const state = () => Effect.runPromise(gh.pullRequestState(REPO, NUMBER));
  /** GitHub refuses to re-run checks from now on. */
  const failRerun = (why: string) => {
    rerun = Effect.die(new Error(why));
  };
  return { ...o, focus, head, reviewed, said, state, trials, reruns, failRerun, refresh: () => focus.refreshBoard(o.project.id) };
}

// docs/merging.md#lanes-how-a-goals-leads-slice-merges: a goal's lead's PR merges by its lane, on every project, whatever its auto-merge switch says
describe('a goal’s lead’s pull request on a board refresh', () => {
  /** A room (auto-merge off) where #8 is a goal's lead's, shipped in `lane`, and QA passed it. */
  async function leads(lane?: 'ship' | 'show' | 'ask') {
    const r = await room();
    vi.spyOn(r.agents, 'leadPrs').mockReturnValue([{ repo: REPO, number: NUMBER, ...(lane && { lane }) }]);
    r.reviewed({ openedByOffice: false });
    return r;
  }

  it('merges one in Ship or Show once QA passes it, with the project’s auto-merge off', async () => {
    for (const lane of ['ship', 'show'] as const) {
      const { project, refresh, state, said } = await leads(lane);
      await refresh();
      expect(project.autoMerge).toBeUndefined();
      await expect.poll(state).toBe('MERGED');
      await expect.poll(() => said('success')).toEqual([expect.stringContaining('🤖 Auto-merged webshop-frontend#8')]);
    }
  });

  it('leaves one in Ask, or shipped before lanes, for the captain', async () => {
    for (const lane of ['ask', undefined] as const) {
      const { refresh, state, trials } = await leads(lane);
      await refresh();
      expect(trials).toEqual([]);
      expect(await state()).toBe('OPEN');
    }
  });
});

describe('auto-merge on a board refresh', () => {
  /** A room with auto-merge on (docs/qa.md: "on each board refresh Ops takes every PR it opened one step closer to merged"). */
  async function auto(...args: Parameters<typeof room>) {
    const r = await room(...args);
    r.project.autoMerge = true;
    return r;
  }

  it('merges a PR QA passed at its head once its merge check passes, and says so', async () => {
    const { reviewed, refresh, state, said, trials, head } = await auto();
    reviewed();
    await refresh();
    await expect.poll(state).toBe('MERGED');
    expect(trials).toEqual([{ base: 'base0000aaa', head }]);
    await expect.poll(() => said('success')).toEqual([expect.stringContaining('🤖 Auto-merged webshop-frontend#8')]);
  });

  it('leaves every PR alone while the project has auto-merge off', async () => {
    const { project, reviewed, refresh, state, said, trials } = await room();
    reviewed();
    await refresh();
    expect(project.autoMerge).toBeUndefined();
    expect(trials).toEqual([]);
    expect(await state()).toBe('OPEN');
    expect(said('success')).toEqual([]);
  });

  // docs/merging.md: "With auto-merge, the refusal blocks that head commit until something new is pushed"
  it('doesn’t try a refused merge again at the same head', async () => {
    const { agents, reviewed, refresh, state, said } = await auto({}, lintFails);
    const merges = vi.spyOn(agents, 'merge');
    reviewed();
    await refresh();
    await expect.poll(() => said('error')).toEqual([expect.stringContaining('🤖 webshop-frontend#8 didn’t merge: `pnpm run lint` fails')]);
    await refresh();
    expect(merges).toHaveBeenCalledTimes(1);
    expect(await state()).toBe('OPEN');
  });

  // with auto-QA on, the refresh's catch-up sends it back first, quietly (verdictBehindHead)
  it('sends a PR to QA when commits arrived after QA passed it, and says why', async () => {
    const { store, project, reviewed, refresh, said } = await auto();
    project.autoQa = false;
    reviewed({ sha: 'older000sha' });
    await refresh();
    expect(store.reviews.get(prKey(REPO, NUMBER))?.status).toBe('queued');
    expect(said('info')).toEqual([expect.stringContaining('🔍 webshop-frontend#8 goes to QA before it can merge: commits arrived after QA passed it')]);
  });

  it('re-runs failing checks once at a head, then sends them back to the developer', async () => {
    const failing: Partial<PullRequest> = { checks: 'failing', failedChecks: [{ name: 'CI / test', url: 'https://example.test/run', runId: RUN }] };
    const { store, project, reviewed, refresh, said, reruns } = await auto(failing);
    // a new project leaves a failed PR with the captain: switched on, checks that keep failing go back to the developer
    project.autoSendBack = true;
    reviewed();
    await refresh();
    expect(reruns).toEqual([[RUN]]);
    expect(said('info')).toEqual([expect.stringContaining('↻ Re-running the failed checks on webshop-frontend#8')]);
    await refresh();
    expect(reruns).toHaveLength(1);
    expect(store.ledger.filter((e) => e.kind === 'checks-sent-back')).toMatchObject([{ repo: REPO, pr: NUMBER, checks: ['CI / test'] }]);
  });

  it('takes on a PR’s conflicts with its base, and says how', async () => {
    const { reviewed, refresh, said } = await auto({ mergeable: 'CONFLICTING' });
    reviewed();
    await refresh();
    expect(said('info')).toEqual([expect.stringContaining('🔧 webshop-frontend#8 conflicts with main')]);
  });

  it('says so when a step fails, and carries on with the board', async () => {
    const { reviewed, refresh, said, failRerun } = await auto({ checks: 'failing', failedChecks: [{ name: 'CI / test', url: 'https://example.test/run', runId: RUN }] });
    reviewed();
    failRerun('GitHub is down');
    await refresh();
    expect(said('error')).toEqual([expect.stringContaining('Auto-merge of webshop-frontend#8: ')]);
  });
});

describe('Merge when QA passes, on a board refresh', () => {
  /** The captain asked for #8 to merge once QA passes it, and QA's verdict is `review`. */
  async function requested(review: Partial<QaReview>, trial?: (heads: MergeHeads) => MergeTrial) {
    const r = await room({}, trial);
    r.reviewed({ ...review, openedByOffice: false, mergeRequested: { at: 1 } });
    return { ...r, request: () => r.store.reviews.get(prKey(REPO, NUMBER))?.mergeRequested };
  }

  // docs/qa.md: "once QA passes, merges exactly the commit QA passed … once its merge check passes"
  it('merges the commit QA passed once its merge check passes, a teammate’s PR too', async () => {
    const { refresh, state, said, trials, head } = await requested({});
    await refresh();
    await expect.poll(state).toBe('MERGED');
    expect(trials).toEqual([{ base: 'base0000aaa', head }]);
    await expect.poll(() => said('success')).toEqual([expect.stringContaining('Merged webshop-frontend#8: QA passed it and its merge checks out, as you asked')]);
  });

  it('waits while QA is testing it', async () => {
    const { refresh, state, trials, request } = await requested({ status: 'testing' });
    await refresh();
    expect(trials).toEqual([]);
    expect(await state()).toBe('OPEN');
    expect(request()).toEqual({ at: 1 });
  });

  // docs/qa.md: "if QA fails it … it tells you and forgets the request"
  it('forgets the request when QA fails it, and says why', async () => {
    const { refresh, said, request } = await requested({ status: 'failed' });
    await refresh();
    expect(request()).toBeUndefined();
    expect(said('error')).toEqual(['webshop-frontend#8 didn’t merge: QA failed it']);
  });

  // docs/qa.md: "if … the merge check or GitHub refuses, it tells you and forgets the request"
  it('forgets the request when its merge check refuses it', async () => {
    const { refresh, said, request, state } = await requested({}, lintFails);
    await refresh();
    await expect.poll(request).toBeUndefined();
    expect(said('error')).toEqual([expect.stringContaining('webshop-frontend#8 didn’t merge: `pnpm run lint` fails')]);
    expect(await state()).toBe('OPEN');
  });

  // docs/qa.md: "Commits that arrive after the pass go back to QA first"
  it('sends it back to QA when commits arrived after the pass, keeping the request', async () => {
    const { store, refresh, said, request } = await requested({ sha: 'older000sha' });
    await refresh();
    expect(store.reviews.get(prKey(REPO, NUMBER))?.status).toBe('queued');
    expect(request()).toEqual({ at: 1 });
    expect(said('info')).toEqual(['🔍 webshop-frontend#8 goes back to QA before it merges: commits arrived after QA passed it']);
  });
});

// docs/merging.md#switching-it-off: every caller's merge skips the check, through the same Merges.merge
describe('a project with the merge check switched off', () => {
  /** A room whose merge check would refuse #8, had the project not switched it off. */
  async function unchecked() {
    const r = await room({}, lintFails);
    r.project.checkMerges = false;
    const merged = () => r.store.ledger.filter((e) => e.kind === 'merge-check');
    return { ...r, merged };
  }

  it('auto-merges a PR QA passed with no trial, at the commit QA passed, and says the check is off', async () => {
    const { project, reviewed, refresh, state, said, trials, merged, head } = await unchecked();
    project.autoMerge = true;
    reviewed();
    await refresh();
    await expect.poll(state).toBe('MERGED');
    expect(trials).toEqual([]);
    expect(merged()).toMatchObject([{ outcome: 'unchecked', by: 'office', head }]);
    await expect.poll(() => said('success')).toEqual([expect.stringContaining('(the merge check is off for this project)')]);
  });

  it('merges a goal’s lead’s slice in Ship or Show with no trial', async () => {
    for (const lane of ['ship', 'show'] as const) {
      const r = await unchecked();
      vi.spyOn(r.agents, 'leadPrs').mockReturnValue([{ repo: REPO, number: NUMBER, lane }]);
      r.reviewed({ openedByOffice: false });
      await r.refresh();
      await expect.poll(r.state).toBe('MERGED');
      expect(r.trials).toEqual([]);
      expect(r.merged()).toMatchObject([{ outcome: 'unchecked', head: r.head }]);
    }
  });

  it('merges once QA passes, as the captain asked, with no trial', async () => {
    const { reviewed, refresh, state, said, trials, merged, store } = await unchecked();
    reviewed({ openedByOffice: false, mergeRequested: { at: 1 } });
    await refresh();
    await expect.poll(state).toBe('MERGED');
    expect(trials).toEqual([]);
    expect(merged()).toMatchObject([{ outcome: 'unchecked', by: 'captain' }]);
    expect(store.reviews.get(prKey(REPO, NUMBER))?.mergeRequested).toBeUndefined();
    await expect.poll(() => said('success')).toEqual(['Merged webshop-frontend#8: QA passed it, as you asked (the merge check is off for this project)']);
  });

  it('merges from the board straight away, with no trial', async () => {
    const { focus, project, state, said, trials, merged } = await unchecked();
    await focus.refreshBoard(project.id);
    expect(focus.mergeFromBoard(project.id, REPO, NUMBER)).toEqual({ checking: true });
    await expect.poll(state).toBe('MERGED');
    expect(trials).toEqual([]);
    expect(merged()).toMatchObject([{ outcome: 'unchecked', by: 'captain' }]);
    await expect.poll(() => said('success')).toEqual(['Merged webshop-frontend#8 (the merge check is off for this project)']);
  });
});

describe('a board refresh', () => {
  it('puts each repo’s open issues and PRs on the board, and tells the browsers', async () => {
    const { focus, store, project, refresh } = await room();
    await refresh();
    const board = store.boards.get(project.id);
    expect(board?.prs.map((p) => `${p.repo}#${p.number}`)).toEqual(expect.arrayContaining([`${REPO}#${NUMBER}`, 'demo/webshop-api#7']));
    expect((await focus.snapshot()).boards).toEqual([board]);
  });

  it('does nothing for a project that isn’t there', async () => {
    const { focus, store } = await room();
    await focus.refreshBoard('no-such-project');
    expect(store.boards.size).toBe(0);
  });
});
