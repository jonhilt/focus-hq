import { Effect, Layer } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { prKey } from '../../shared/qa';
import { demoLayer } from '../github/demo';
import { GitHub } from '../github/service';
import { demoWorkspace } from './demoRunner';
import { office, restarted } from './fakeOffice';
import type { WorkspaceOps } from './types';
import { checkAtOnce, checkRestart, type Later, now, type Running, type Subject } from './invariants';

// QA reviews, under the office's two rules (docs/invariants.md): a restart is atomic, and two things at once end as one
// after the other would. Described here (what can happen to a review, what must survive), not told what to expect.

vi.setConfig({ testTimeout: 120_000 });

/** QA's report, accounting for every changed file (there are none here), so it isn't sent back to look again. */
/** A fail comes with a proof test, which fails when the office runs it (the workspace's `runIn`), so it blocks. */
const report = (verdict: 'pass' | 'fail') => ({
  verdict,
  summary: verdict === 'pass' ? 'Works.' : 'Broken.',
  checks: [],
  commands: [],
  files: [],
  ...(verdict === 'fail' && { fixInstructions: 'Fix it.', proofs: [{ kind: 'test', finding: 'Broken', file: 'a.proof.test.ts', command: 'vitest run a.proof.test.ts' }] }),
});
/** The demo's workspace, its slow steps (made slow on purpose, to watch in the demo) answered through `later` instead. */
const workspace = (later: Later): WorkspaceOps => ({
  ...demoWorkspace,
  changedFiles: () => Promise.resolve([]),
  checkoutPullRequest: () => later('checkout', () => Promise.resolve('')),
  sinceVerdict: (_repo, _number, _base, sha) => later('since', () => demoWorkspace.sinceVerdict(_repo, _number, _base, sha)),
  push: () => later('push', () => Promise.resolve()),
  publish: () => later('publish', () => Promise.resolve()),
  pull: () => later('pull', () => Promise.resolve()),
  runIn: () => Promise.resolve({ code: 1, output: 'AssertionError: expected 1 to be 2' }),
});
const [first, second] = await Effect.runPromise(Effect.gen(function* () {
  return yield* (yield* GitHub).listPullRequests('demo/webshop-frontend');
}).pipe(Effect.provide(demoLayer)));
const prs = [first, second].flatMap((pr) => (pr ? [pr] : []));

/** Until what `read` says stops changing (three looks 10 ms apart, two seconds at most). */
const steady = async (read: () => unknown) => {
  let last = JSON.stringify(read());
  for (let same = 0, i = 0; same < 3 && i < 200; i++) {
    await new Promise((r) => setTimeout(r, 10));
    const now = JSON.stringify(read());
    same = now === last ? same + 1 : 0;
    last = now;
  }
};

interface Kept {
  pr: number;
  status?: string;
  verdicts: number;
  comments: number;
}

const reviews: Subject<Kept[]> = {
  name: 'reviews',
  start: (start) => {
    // what went up on each pull request, kept across lives as GitHub keeps it
    const comments = new Map<number, string[]>();
    /** The demo's GitHub, its comments on pull requests answered through `later`. */
    const github = (later: Later) =>
      Layer.effect(GitHub, Effect.gen(function* () {
        const gh = yield* GitHub;
        return GitHub.of({
          ...gh,
          commentOnPullRequest: (_repo, number, body) =>
            Effect.promise(() => later('comment', () => (comments.set(number, [...(comments.get(number) ?? []), body]), Promise.resolve(`https://github.com/c/${number}`)))),
          pullRequestComments: (_repo, number) => Effect.promise(() => later('read comments', () => Promise.resolve([...(comments.get(number) ?? [])]))),
        });
      })).pipe(Layer.provide(demoLayer));
    const kept = (store: ReturnType<typeof office>['store']): Kept[] =>
      prs.map((pr) => ({
        pr: pr.number,
        status: store.reviews.get(prKey(pr.repo, pr.number))?.status,
        verdicts: store.ledger.filter((e) => e.kind === 'qa-verdict' && e.pr === pr.number).length,
        comments: comments.get(pr.number)?.length ?? 0,
      }));
    const life = (o: Pick<ReturnType<typeof office>, 'agents' | 'claude' | 'store'>): Running<Kept[]> => {
      const ended = new Set<number>();
      // QA's turn under way, ended once: with none under way, there's nothing to end
      const turn = () => {
        const at = o.claude.turns.findIndex((t, i) => !t.stopped && !ended.has(i));
        const t = o.claude.turns[at];
        if (!t) throw new Error('QA has no turn under way');
        ended.add(at);
        return t;
      };
      const project = o.store.projects[0];
      return {
        actions: () => [
          ...prs.map((pr) => ({ name: `review #${pr.number} asked for`, run: () => project && o.agents.requestReview(project.id, pr.repo, pr.number, pr.title) })),
          { name: 'QA passes it', run: () => turn().end({ ok: true, summary: '', structured: report('pass') }) },
          { name: 'QA fails it', run: () => turn().end({ ok: true, summary: '', structured: report('fail') }) },
        ],
        durable: () => kept(o.store),
        settle: () => steady(() => [kept(o.store), o.claude.turns.length]),
        close: () => o.agents.shutDown(),
        restart: (later) => {
          o.agents.shutDown();
          const after = restarted(o.store, workspace(later), github(later));
          after.agents.recover();
          return life({ ...after, store: o.store });
        },
      };
    };
    return life(office(workspace(start), github(start)));
  },
};

describe('QA reviews, under the office’s two rules', () => {
  // a description that never got a review past the queue would pass both rules and prove nothing
  it('reaches a review under test, a failed one and a passed one, taken one at a time', async () => {
    const r = await reviews.start(now);
    const said: (string | undefined)[] = [];
    for (const name of ['review #7 asked for', 'review #8 asked for', 'QA fails it', 'QA passes it']) {
      await Promise.resolve(r.actions().find((a) => a.name === name)?.run()).catch(() => undefined);
      await r.settle();
      said.push(...r.durable().map((k) => k.status));
    }
    r.close?.();
    expect(said).toEqual(expect.arrayContaining(['testing', 'failed', 'passed']));
  });

  it('end a restart as if what was under way had never started, or had finished', async () => {
    await checkRestart(reviews, { runs: 20 });
  });

  it('end two things at once as one after the other would', async () => {
    await checkAtOnce(reviews, { runs: 20 });
  });
});

describe('what QA runs, as docs/qa.md promises', () => {
  const facts = { packageJson: true, scripts: { typecheck: 'tsc', lint: 'eslint .', test: 'vitest run' }, lockfiles: ['pnpm-lock.yaml'], claudeMd: true };

  // "A review's step 3 names the same commands, read from QA's checkout of the PR."
  it('tells QA to run the merge checks its checkout of the PR has', async () => {
    const o = office({ ...workspace(now), packageFacts: () => Promise.resolve(facts) });
    const project = o.store.projects[0];
    const pr = prs[0];
    if (!project || !pr) throw new Error('the demo has no project or pull request');
    o.store.updateProject(project.id, { mergeChecks: ['lint', 'test'] });
    o.agents.requestReview(project.id, pr.repo, pr.number, pr.title);
    await steady(() => o.claude.turns.length);
    o.agents.shutDown();
    expect(o.claude.turns[0]?.req.systemAppend).toContain("run these checks: `pnpm run lint`, `pnpm test`, and anything else the repo's CLAUDE.md asks.");
  });

  // "per repo, the project's merge checks the repo's package.json has … read from the office's clone; with no clone … QA works the checks out itself"
  it('shows at the Playbook what QA runs on each repo, from the office’s clone', async () => {
    const o = office({ ...workspace(now), cloneFacts: (repo) => Promise.resolve(repo === 'demo/webshop-frontend' ? facts : undefined) });
    const project = o.store.projects[0];
    if (!project) throw new Error('the demo has no project');
    const playbook = await o.agents.qaPlaybook(project.id);
    o.agents.shutDown();
    expect(playbook.repos.find((r) => r.repo === 'demo/webshop-frontend')?.commands).toEqual(['pnpm run typecheck', 'pnpm run lint', 'pnpm test']);
    expect(playbook.repos.filter((r) => r.repo !== 'demo/webshop-frontend').every((r) => !r.cloned && !r.commands.length)).toBe(true);
  });
});
