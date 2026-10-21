import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { demoWorkspace } from '../agents/demoRunner';
import { demoLayer, demoPush } from './demo';
import { GitHub } from './service';

// What the demo's GitHub must keep of the real one (docs/contracts.md): behaviours real GitHub showed Ops, some
// of them only by breaking it. Real GitHub can't be reached from a test, so these are written as tests of the demo; a
// live check would run the same against `ghCliLayer` on a sandbox repository (see the doc for what it needs).

/** A fresh demo GitHub, and a pull request Ops opened on it from `branch`. */
async function opened(branch = 'focus/contract') {
  const gh = Effect.runSync(Effect.provide(GitHub, demoLayer));
  const repo = 'demo/webshop-frontend';
  const pr = await Effect.runPromise(gh.createPullRequest(repo, { head: branch, base: 'main', title: 'Contract', body: 'Closes #1' }));
  const head = async () => (await Effect.runPromise(gh.getPullRequest(repo, pr.number))).headSha;
  return { gh, repo, pr, head };
}
const refused = <A, E>(op: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(op));

describe('the demo GitHub keeps the GitHub contract', () => {
  it('reports the head GitHub has, which a push from Ops doesn’t move at once (57f3d0e)', async () => {
    const { repo, pr, head } = await opened();
    const before = await head();
    // Ops' ship pushes, and GitHub's head lags: here it never catches up, so code that trusts it shows
    await demoWorkspace.push(`/demo/lead`, 'focus/contract');
    expect(await head()).toBe(before);
    // someone else's push (Ops' merge of the base, say) is what moves it
    const after = demoPush?.(repo, pr.number, 'change');
    expect(after).toBeDefined();
    expect(await head()).toBe(after);
  });

  it('refuses a merge that names a head the pull request has moved on from', async () => {
    const { gh, repo, pr, head } = await opened();
    const seen = await head();
    demoPush?.(repo, pr.number, 'change');
    expect((await refused(gh.mergePullRequest(repo, pr.number, 'squash', seen)))._tag).toBe('GitHubRejected');
    await Effect.runPromise(gh.mergePullRequest(repo, pr.number, 'squash', await head()));
    expect(await Effect.runPromise(gh.pullRequestState(repo, pr.number))).toBe('MERGED');
  });

  it('finds only an open pull request from a branch: none once it merged', async () => {
    const { gh, repo, pr } = await opened('focus/found');
    expect(await Effect.runPromise(gh.findPullRequest(repo, 'focus/found'))).toEqual({ number: pr.number, url: pr.url });
    await Effect.runPromise(gh.mergePullRequest(repo, pr.number, 'squash'));
    expect(await Effect.runPromise(gh.findPullRequest(repo, 'focus/found'))).toBeNull();
  });

  it('refuses a second open pull request from the same branch', async () => {
    const { gh, repo } = await opened('focus/twice');
    expect((await refused(gh.createPullRequest(repo, { head: 'focus/twice', base: 'main', title: 'Again', body: '' })))._tag).toBe('GitHubRejected');
  });

  it('says a pull request it hasn’t got is not found, rather than closed', async () => {
    const { gh, repo } = await opened();
    expect((await refused(gh.pullRequestState(repo, 9999)))._tag).toBe('GitHubNotFound');
  });

  it('refuses to merge or close a pull request that isn’t open', async () => {
    const { gh, repo, pr } = await opened();
    await Effect.runPromise(gh.mergePullRequest(repo, pr.number, 'squash'));
    expect((await refused(gh.mergePullRequest(repo, pr.number, 'squash')))._tag).toBe('GitHubRejected');
    expect((await refused(gh.closePullRequest(repo, pr.number, 'Superseded')))._tag).toBe('GitHubRejected');
  });

  it('gives a pull request’s comments back, so a restart can find a verdict it already posted', async () => {
    const { gh, repo, pr } = await opened();
    await Effect.runPromise(gh.commentOnPullRequest(repo, pr.number, 'QA passed <!-- focus-verdict:abc -->'));
    expect(await Effect.runPromise(gh.pullRequestComments(repo, pr.number))).toEqual(['QA passed <!-- focus-verdict:abc -->']);
  });

  // GitHub says UNKNOWN while it works out whether a PR merges, after every push to it or its base (33dc5c2): the demo
  // always knows. What Ops does with UNKNOWN is tested on its own (shared/board.test.ts).
  it.fails('can report a pull request’s mergeability as UNKNOWN just after a push [simplified: the demo always knows]', async () => {
    const { gh, repo, pr } = await opened();
    demoPush?.(repo, pr.number, 'change');
    const listed = (await Effect.runPromise(gh.listPullRequests(repo))).find((p) => p.number === pr.number);
    expect(listed?.mergeable).toBe('UNKNOWN');
  });
});
