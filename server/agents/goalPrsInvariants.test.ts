import { describe, expect, it } from 'vitest';
import type { PullRequest } from '../../shared/types';
import { demoWorkspace } from './demoRunner';
import { focus, restarted, until } from './fakeFocus';
import { checkAtOnce, checkRestart, type Later, now, type Running, type Subject } from './invariants';
import { leadWorktreeId } from './lead';

// A goal lead's own pull requests, claimed as the goal's (docs/goals.md, "A pull request they open themselves"),
// under Focus's two rules (docs/invariants.md). Reading where a checkout has been is git's, so it goes through
// `later`; what's kept is the lead's pull requests and the ledger's pr lines.

/** Two PRs the lead opened from branches their frontend checkout has been on, and one from a branch nobody's has. */
const pr = (number: number, branch: string, isDraft = false): PullRequest => ({
  repo: 'demo/webshop-frontend', number, title: `PR ${number}`, url: `https://github.com/demo/webshop-frontend/pull/${number}`, branch, baseBranch: 'main',
  isDraft, mergeable: 'MERGEABLE', checks: 'passing', failedChecks: [], closes: [], createdAt: '2026-10-25T00:00:00Z',
});
const board = [pr(90, 'fix/held-frame', true), pr(91, 'fix/typo'), pr(92, 'someone-else')];

/** The goal's PRs, and the ledger's pr lines: each claimed PR once in both, or claimed twice. */
interface Claimed {
  prs: string[];
  lines: string[];
}

const claimed: Subject<Claimed> = {
  name: 'goal PRs',
  start: async (later) => {
    // where the lead's checkouts have been is git's, kept on disk: it outlives Focus
    const seen = new Map<string, string[]>();
    let reading: Later = later;
    const workspace = { ...demoWorkspace, branchesSeen: (dir: string) => reading('reflog', () => Promise.resolve(seen.get(dir) ?? [])) };
    const first = focus(workspace);
    const { store, project } = first;
    const { agent } = first.agents.startGoal(project.id, 'Saved items') as { agent: { id: string } };
    await until(() => first.claude.turns.length === 1);
    const { folder } = store.agent(agent.id).lead!.repos.find((r) => r.repo === 'demo/webshop-frontend')!;
    seen.set(demoWorkspace.dir(leadWorktreeId(agent.id, folder)), ['main', 'fix/held-frame', 'fix/typo']);
    const durable = (): Claimed => ({
      prs: store.agent(agent.id).lead!.prs.map((p) => `${p.number} ${p.branch ?? ''}`).sort(),
      lines: store.ledger.flatMap((e) => (e.kind === 'pr' ? [`${e.pr} ${e.branch}${e.draft ? ' draft' : ''}`] : [])).sort(),
    });
    const life = (agents: typeof first.agents): Running<Claimed> => {
      let going: Promise<unknown> = Promise.resolve();
      return {
        actions: () => [{ name: 'the board refreshes', run: () => (going = Promise.all([going, agents.boardRefreshed(project.id, board)])) }],
        durable,
        settle: async () => void (await going),
        close: () => agents.shutDown(),
        restart: (next) => {
          agents.shutDown();
          reading = next;
          return life(restarted(store, workspace).agents);
        },
      };
    };
    return life(first.agents);
  },
};

describe('a goal lead’s own pull requests, under Focus’s two rules', () => {
  it('claims the PRs from branches the lead’s checkout has been on, once however often the board refreshes', async () => {
    const r = await claimed.start(now);
    for (let i = 0; i < 2; i++) {
      await Promise.resolve(r.actions()[0].run());
      await r.settle();
    }
    expect(r.durable()).toEqual({ prs: ['90 fix/held-frame', '91 fix/typo'], lines: ['90 fix/held-frame draft', '91 fix/typo'] });
    r.close?.();
  });

  it('keeps what it claimed through a restart, and claims nothing more after it', async () => {
    const r = await claimed.start(now);
    await Promise.resolve(r.actions()[0].run());
    await r.settle();
    const after = await r.restart(now);
    await Promise.resolve(after.actions()[0].run());
    await after.settle();
    expect(after.durable()).toEqual({ prs: ['90 fix/held-frame', '91 fix/typo'], lines: ['90 fix/held-frame draft', '91 fix/typo'] });
    after.close?.();
  });

  it('end a restart as if what was under way had never started, or had finished', async () => {
    await checkRestart(claimed, { runs: 15, prefix: 2 });
  });

  it('end two things at once as one after the other would', async () => {
    await checkAtOnce(claimed, { runs: 15, prefix: 2 });
  });
});
