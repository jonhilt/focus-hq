import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';
import { demoLayer } from './demo';
import { ghCliService } from './ghCli';
import { classify, GhCommandFailed, GhNotInstalled, GhRunner, type GhCommandError } from './runner';
import { GitHub, toProvider } from './service';

/** The gh layer over a fake runner that answers each command from `reply`, and remembers what it was asked. */
function fakeGh(reply: (args: readonly string[]) => Effect.Effect<string, GhCommandError>) {
  const calls: (readonly string[])[] = [];
  const runner = Layer.succeed(GhRunner, GhRunner.of({
    // suspended, so a call counts when it runs rather than when an Effect is built from it
    run: (args) =>
      Effect.suspend(() => {
        calls.push(args);
        return reply(args);
      }),
  }));
  return { calls, layer: ghCliService.pipe(Layer.provide(runner)) };
}

const succeed = <A, E>(layer: Layer.Layer<GitHub>, op: (gh: GitHub['Service']) => Effect.Effect<A, E>) =>
  Effect.runPromise(GitHub.use(op).pipe(Effect.provide(layer)));
const fail = <A, E>(layer: Layer.Layer<GitHub>, op: (gh: GitHub['Service']) => Effect.Effect<A, E>) =>
  Effect.runPromise(GitHub.use(op).pipe(Effect.flip, Effect.provide(layer)));

const prJson = JSON.stringify([{
  number: 12,
  title: 'Save items for later',
  url: 'https://github.com/acme/shop/pull/12',
  headRefName: 'focus/7-save-for-later',
  headRefOid: 'abc123',
  baseRefName: 'main',
  author: { login: 'jon' },
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: '',
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }],
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T11:00:00Z',
  body: 'Adds a saved-for-later list.\n\nCloses #7, fixes #9',
  closingIssuesReferences: [{ number: 7 }, { number: 8 }],
}]);

describe('gh CLI layer', () => {
  it('maps gh pr list output to pull requests', async () => {
    const { calls, layer } = fakeGh(() => Effect.succeed(prJson));
    expect(await succeed(layer, (gh) => gh.listPullRequests('acme/shop'))).toEqual([{
        repo: 'acme/shop',
        number: 12,
        title: 'Save items for later',
        url: 'https://github.com/acme/shop/pull/12',
        branch: 'focus/7-save-for-later',
        headSha: 'abc123',
        baseBranch: 'main',
        author: 'jon',
        isDraft: false,
        mergeable: 'MERGEABLE',
        reviewDecision: undefined,
        checks: 'pending',
        closes: [7, 8, 9],
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T11:00:00Z',
      }]);
    expect(calls[0].slice(0, 5)).toEqual(['pr', 'list', '-R', 'acme/shop', '--state']);
  });

  it('fails with GhCommandFailed, keeping stderr and the exit code', async () => {
    const { layer } = fakeGh((args) => Effect.fail(new GhCommandFailed({ args, stderr: 'GraphQL: Could not resolve to a Repository', exitCode: 1 })));
    const error = await fail(layer, (gh) => gh.listPullRequests('acme/nope'));
    expect(error).toBeInstanceOf(GhCommandFailed);
    expect(error).toMatchObject({ _tag: 'GhCommandFailed', stderr: 'GraphQL: Could not resolve to a Repository', exitCode: 1 });
    expect(error.message).toBe('gh pr list -R failed: GraphQL: Could not resolve to a Repository');
  });

  it('fails with GhBadOutput when gh prints broken or misshapen JSON', async () => {
    for (const output of ['not json', JSON.stringify([{ number: 'twelve' }])]) {
      const { layer } = fakeGh(() => Effect.succeed(output));
      expect(await fail(layer, (gh) => gh.listPullRequests('acme/shop'))).toMatchObject({ _tag: 'GhBadOutput', output });
    }
  });

  it('fails with GhBadOutput when gh pr create prints no PR URL', async () => {
    const { layer } = fakeGh(() => Effect.succeed('Warning: something odd\n'));
    const error = await fail(layer, (gh) => gh.createPullRequest('acme/shop', { head: 'b', base: 'main', title: 't', body: 'b' }));
    expect(error._tag).toBe('GhBadOutput');
  });

  it('reports a missing gh as a status, not a failure', async () => {
    const { layer } = fakeGh(() => Effect.fail(new GhNotInstalled()));
    expect(await succeed(layer, (gh) => gh.status)).toEqual({
      ok: false,
      error: 'gh is not ready: the GitHub CLI (gh) is not installed or not on the PATH. Install the GitHub CLI and run "gh auth login".',
    });
  });
});

describe('classify', () => {
  const err = (code: string | number) => Object.assign(new Error('Command failed'), { code, cmd: 'gh' });

  it('tells a missing gh, a logged-out gh and a failed command apart', () => {
    expect(classify(['api', 'user'], err('ENOENT'), '')._tag).toBe('GhNotInstalled');
    expect(classify(['api', 'user'], err(4), 'To get started with GitHub CLI, please run:  gh auth login')._tag).toBe('GhNotAuthenticated');
    expect(classify(['pr', 'merge', '3'], err(1), 'Pull request is not mergeable')).toMatchObject({ _tag: 'GhCommandFailed', exitCode: 1 });
  });
});

describe('Promise adapter', () => {
  it('resolves with the result and rejects with the tagged error', async () => {
    const github = toProvider(demoLayer);
    expect((await github.listIssues('demo/space-dodger')).map((i) => i.number)).toEqual([1, 2, 3, 4]);
    await expect(github.listIssues('demo/missing')).rejects.toMatchObject({
      _tag: 'GitHubNotFound',
      message: expect.stringContaining('Repository demo/missing not found') as unknown,
    });
  });

  it('keeps demo state between calls: a merged PR closes its issue and cannot merge again', async () => {
    const github = toProvider(demoLayer);
    const pr = await github.createPullRequest('demo/space-dodger', { head: 'focus/1-scores', base: 'main', title: 'High scores', body: 'Closes #1' });
    await github.mergePullRequest('demo/space-dodger', pr.number, 'squash');
    expect(await github.pullRequestState('demo/space-dodger', pr.number)).toBe('MERGED');
    expect((await github.listIssues('demo/space-dodger')).map((i) => i.number)).toEqual([2, 3, 4]);
    await expect(github.mergePullRequest('demo/space-dodger', pr.number, 'squash')).rejects.toMatchObject({ _tag: 'GitHubRejected' });
  });
});
