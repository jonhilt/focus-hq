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
const report = (verdict: 'pass' | 'fail') => ({ verdict, summary: verdict === 'pass' ? 'Works.' : 'Broken.', checks: [], commands: [], files: [], ...(verdict === 'fail' && { fixInstructions: 'Fix it.' }) });
/** The demo's workspace, its slow steps (made slow on purpose, to watch in the demo) answered through `later` instead. */
const workspace = (later: Later): WorkspaceOps => ({
  ...demoWorkspace,
  changedFiles: () => Promise.resolve([]),
  checkoutPullRequest: () => later('checkout', () => Promise.resolve('')),
  sinceVerdict: (_repo, _number, _base, sha) => later('since', () => demoWorkspace.sinceVerdict(_repo, _number, _base, sha)),
  push: () => later('push', () => Promise.resolve()),
  publish: () => later('publish', () => Promise.resolve()),
  pull: () => later('pull', () => Promise.resolve()),
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
