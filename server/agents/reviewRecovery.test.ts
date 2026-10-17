import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { prKey } from '../../shared/qa';
import { demoLayer } from '../github/demo';
import { GitHub } from '../github/service';
import { demoWorkspace } from './demoRunner';
import { office, restarted, until } from './fakeOffice';
import { RESUMED_NOTE } from './runJournal';

// QA reviews after Focus restarts, from their journals (reviewJournal.ts): each starts with the office shutting down on
// purpose, the path a crash and an update both end up on.

/** QA's report, accounting for every changed file (there are none here), so it isn't sent back to look again. */
const pass = { verdict: 'pass', summary: 'Works.', checks: [], commands: [], files: [] };
const workspace = { ...demoWorkspace, changedFiles: () => Promise.resolve([]) };
const pullRequests = () => Effect.runPromise(Effect.gen(function* () {
  return yield* (yield* GitHub).listPullRequests('demo/webshop-frontend');
}).pipe(Effect.provide(demoLayer)));
/** The demo's GitHub, with its comments on pull requests changed. */
const commenting = (comment: (body: string) => Effect.Effect<string>) => Layer.effect(GitHub, Effect.gen(function* () {
  const gh = yield* GitHub;
  return GitHub.of({ ...gh, commentOnPullRequest: (_repo, _number, body) => comment(body) });
})).pipe(Layer.provide(demoLayer));

describe('a QA review after Focus restarts', () => {
  it('picks the review it cut off back up in QA’s conversation, and keeps the one waiting in line', async () => {
    const before = office(workspace);
    const [first, second] = await pullRequests();
    before.agents.requestReview(before.project.id, first.repo, first.number, first.title);
    before.agents.requestReview(before.project.id, second.repo, second.number, second.title);
    await until(() => before.claude.turns.length === 1);
    before.claude.turns[0].hooks.session('qa-session');
    const status = (pr: { repo: string; number: number }) => before.store.reviews.get(prKey(pr.repo, pr.number))?.status;
    expect(status(second)).toBe('queued');

    before.agents.shutDown();
    const after = restarted(before.store, workspace);
    after.agents.recover();
    await until(() => after.claude.turns.length === 1);
    expect(after.claude.turns[0].req).toMatchObject({ resumeSessionId: 'qa-session', prompt: RESUMED_NOTE });
    expect(status(first)).toBe('testing');
    after.claude.turns[0].end({ ok: true, summary: '', structured: pass });
    await until(() => status(first) === 'passed');
    expect(before.store.review(prKey(first.repo, first.number)).phase).toBe('passed');

    // then the one that waited, from the start
    await until(() => after.claude.turns.length === 2);
    expect(after.claude.turns[1].req.resumeSessionId).toBeUndefined();
    after.claude.turns[1].end({ ok: true, summary: '', structured: pass });
    await until(() => status(second) === 'passed');
  });

  it('posts a verdict it had before it was on the pull request, without another turn, and says it once', async () => {
    // the comment never goes up: Focus shuts down while it's on its way
    const before = office(workspace, commenting(() => Effect.never));
    const [pr] = await pullRequests();
    const key = prKey(pr.repo, pr.number);
    before.agents.requestReview(before.project.id, pr.repo, pr.number, pr.title);
    await until(() => before.claude.turns.length === 1);
    before.claude.turns[0].end({ ok: true, summary: '', structured: pass });
    await until(() => typeof before.store.review(key).phase === 'object');
    expect(before.store.review(key).phase).toEqual({ reported: 'posting' });
    expect(before.store.reviews.get(key)?.status).toBe('testing');

    before.agents.shutDown();
    const posted: string[] = [];
    const after = restarted(before.store, workspace, commenting((body) => Effect.sync(() => (posted.push(body), 'https://github.com/c/1'))));
    after.agents.recover();
    await until(() => before.store.reviews.get(key)?.status === 'passed');
    expect(after.claude.turns).toHaveLength(0);
    expect(posted).toHaveLength(1);
    expect(before.store.reviews.get(key)).toMatchObject({ commentUrl: 'https://github.com/c/1', report: { verdict: 'pass' } });
    expect(before.store.ledger.filter((e) => e.kind === 'qa-verdict')).toHaveLength(1);
    expect(before.store.review(key).phase).toBe('passed');
  });

  it('hands a PR the operations officer was looking at to the captain', async () => {
    const before = office(workspace);
    const [pr] = await pullRequests();
    const key = prKey(pr.repo, pr.number);
    before.store.reviewJournal(key, { kind: 'imported', review: { projectId: before.project.id, repo: pr.repo, number: pr.number, title: pr.title, status: 'failed', requestedAt: 1, finishedAt: 2 } });
    before.store.reviewJournal(key, { kind: 'triaging', officer: 'Lt. Ops' });

    before.agents.shutDown();
    const after = restarted(before.store, workspace);
    after.agents.recover();
    expect(before.store.reviews.get(key)?.followUp).toEqual({ kind: 'needs-you', reason: 'Lt. Ops was looking at it when Focus shut down' });
    expect(before.store.reviewEntries(key).at(-1)).toMatchObject({ kind: 'follow-up', followUp: { kind: 'needs-you' } });
  });

  it('starts a review again when its reviewer was still checking it out', async () => {
    // the checkout never finishes: no Claude turn has started
    const before = office({ ...workspace, checkoutPullRequest: () => new Promise<string>(() => undefined) });
    const [pr] = await pullRequests();
    const key = prKey(pr.repo, pr.number);
    before.agents.requestReview(before.project.id, pr.repo, pr.number, pr.title);
    await until(() => before.store.review(key).phase === 'seated');

    before.agents.shutDown();
    const after = restarted(before.store, workspace);
    after.agents.recover();
    await until(() => after.claude.turns.length === 1);
    expect(after.claude.turns[0].req.resumeSessionId).toBeUndefined();
    expect(before.store.reviews.get(key)?.status).toBe('testing');
    after.claude.turns[0].end({ ok: true, summary: '', structured: pass });
    await until(() => before.store.reviews.get(key)?.status === 'passed');
  });

  // A known bug, kept failing on purpose until it's fixed (it.fails passes while the test fails, and fails once it
  // passes): a verdict that reached the pull request as the office went down is posted again after the restart, as
  // the office can't tell it went up (GitHub's service has no way to read a pull request's comments back). Found by
  // checkRestart (docs/invariants.md#found-on-main).
  it.fails('doesn’t post a verdict again that reached the pull request just before the office went down', async () => {
    // the comment goes up, and the office goes down before it hears so
    const posted: string[] = [];
    const before = office(workspace, commenting((body) => Effect.sync(() => posted.push(body)).pipe(Effect.andThen(Effect.never))));
    const [pr] = await pullRequests();
    const key = prKey(pr.repo, pr.number);
    before.agents.requestReview(before.project.id, pr.repo, pr.number, pr.title);
    await until(() => before.claude.turns.length === 1);
    before.claude.turns[0].end({ ok: true, summary: '', structured: pass });
    await until(() => posted.length === 1);

    before.agents.shutDown();
    const after = restarted(before.store, workspace, commenting((body) => Effect.sync(() => (posted.push(body), 'https://github.com/c/1'))));
    after.agents.recover();
    await until(() => before.store.reviews.get(key)?.status === 'passed');
    expect(posted).toHaveLength(1);
  });
});
