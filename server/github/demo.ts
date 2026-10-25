import { Effect, Layer } from 'effect';
import { sameCommit } from '../../shared/qa';
import type { Issue, PrReview, PullRequest, ReviewComment } from '../../shared/types';
import { demoCommit } from '../demoGit';
import { closingIssues, evidenceUrl } from './provider';
import { GitHub, GitHubNotFound, GitHubRejected } from './service';

interface FakeRepo {
  description: string;
  issues: Issue[];
  prs: (PullRequest & { state: 'OPEN' | 'CLOSED' | 'MERGED'; body?: string; comments?: string[]; rerunAt?: number; reviewComments?: Record<string, ReviewComment[]> })[];
  nextNumber: number;
}

/** An open PR an agent made earlier: its title, the (1-based) seed issue it closes, and how many hours ago it was last pushed. */
type SeedPr = [string, number, number];

const SEED: Record<string, { description: string; issues: [string, string, string[]][]; prs?: SeedPr[] }> = {
  'demo/webshop-frontend': {
    description: 'Storefront for the cartoon sock shop',
    issues: [
      ['Add a dark mode toggle to the header', 'Users want a dark theme. Persist the choice in localStorage.', ['enhancement']],
      ['Cart badge does not update after removing an item', 'Steps: add 2 items, remove 1, badge still says 2.', ['bug']],
      ['Product page images are blurry on retina screens', 'Serve 2x images via srcset.', ['bug']],
      ['Add "Recently viewed" carousel to the home page', 'Show the last 6 products the visitor opened.', ['enhancement']],
      ['Checkout button should be disabled while submitting', 'Double clicks create duplicate orders.', ['bug']],
      ['Wishlist page with a heart on every product', 'Save socks for later. Needs the wishlist API.', ['enhancement', 'feature:wishlist']],
    ],
    prs: [['Wishlist page with a heart on every product', 6, 2]],
  },
  'demo/webshop-api': {
    description: 'REST API for the sock shop',
    issues: [
      ['Rate limit the /login endpoint', 'Max 10 attempts per minute per IP.', ['security']],
      ['Add pagination to GET /products', 'Support ?page and ?pageSize, default 20.', ['enhancement']],
      ['Orders endpoint returns 500 for empty carts', 'Should be a 422 with a helpful message.', ['bug']],
      ['Wishlist endpoints', 'GET/PUT/DELETE /wishlist for the signed-in shopper.', ['enhancement', 'feature:wishlist']],
    ],
    // two attempts at the same issue: a preview picks the one pushed to last
    prs: [['Wishlist endpoints (first try)', 4, 30], ['Wishlist endpoints', 4, 1]],
  },
  'demo/space-dodger': {
    description: 'A tiny browser game about dodging asteroids',
    issues: [
      ['Add a high score table', 'Keep the top 10 scores in localStorage and show them on game over.', ['enhancement']],
      ['Ship clips through asteroids at high speed', 'Collision check misses fast frames; use swept collision.', ['bug']],
      ['Add sound effects with a mute button', 'Explosion + thruster sounds. Mute toggle in the corner, and silence while paused.\n\nDepends on #4', ['enhancement']],
      ['Pause the game when the tab is hidden', 'Use the visibilitychange event.', ['enhancement']],
    ],
  },
};

/** Checks "finish" a little while after the PR is opened, or after a re-run. */
const CHECKS_TAKE_MS = 20_000;
/** The demo's pretend GitHub Actions run for a PR: one per PR, so a re-run finds its PR from the run id. */
const RUN_IDS = 4000;

/** In-memory GitHub used by `pnpm run demo`: the seed repos above, changed by whatever Ops does to them. */
/** Pushes to an open demo PR: a merge of its base branch, or a change of its own. Set while a demo GitHub is around. */
export let demoPush: ((repo: string, number: number, kind: 'merge-base' | 'change') => string) | undefined;

/** A demo lead opening a PR of their own (a draft unless `draft` is false), as `gh pr create` would. Set while a demo GitHub is around. */
export let demoOpenPr: ((repo: string, req: { head: string; base: string; title: string; body: string }, draft?: boolean) => { number: number; url: string }) | undefined;

/** A demo lead marking their draft ready for review, as `gh pr ready` would. Set while a demo GitHub is around. */
export let demoReady: ((repo: string, number: number) => void) | undefined;

/** Someone reviewing an open demo PR on GitHub, with comments on lines of its code: the review's id. Set while a demo GitHub is around. */
export let demoReview: ((repo: string, number: number, review: Omit<PrReview, 'id' | 'submittedAt'>, comments?: Omit<ReviewComment, 'author'>[]) => string) | undefined;

export const demoLayer = Layer.sync(GitHub, () => {
  const repos = new Map<string, FakeRepo>();
  const opened = (r: FakeRepo, name: string, req: { head: string; base: string; title: string; body: string }, isDraft: boolean) => {
    const number = r.nextNumber++;
    const url = `https://github.com/${name}/pull/${number}`;
    r.prs.push({
      repo: name,
      number,
      title: req.title,
      url,
      branch: req.head,
      baseBranch: req.base,
      author: 'demo-manager',
      isDraft,
      mergeable: 'MERGEABLE',
      checks: 'pending',
      failedChecks: [],
      closes: closingIssues(req.body),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'OPEN',
      body: req.body,
      headSha: Math.random().toString(16).slice(2, 12).padEnd(10, '0'),
    });
    return { number, url };
  };
  demoReady = (name, number) => {
    const p = repos.get(name)?.prs.find((p) => p.number === number && p.state === 'OPEN');
    if (!p) throw new Error(`${name}#${number} is not an open pull request`);
    p.isDraft = false;
    p.updatedAt = new Date().toISOString();
  };
  demoOpenPr = (name, req, draft = true) => {
    const r = repos.get(name);
    if (!r) throw new Error(`${name} is not a demo repo`);
    return opened(r, name, req, draft);
  };
  demoReview = (name, number, review, comments = []) => {
    const p = repos.get(name)?.prs.find((p) => p.number === number && p.state === 'OPEN');
    if (!p) throw new Error(`${name}#${number} is not an open pull request`);
    const id = `PRR_demo_${name.replace(/\W/g, '_')}_${number}_${(p.reviews ?? []).length + 1}`;
    p.reviews = [...(p.reviews ?? []), { ...review, id, submittedAt: new Date().toISOString() }];
    p.reviewComments = { ...p.reviewComments, [id]: comments.map((c) => ({ ...c, author: review.author })) };
    p.updatedAt = new Date().toISOString();
    return id;
  };
  demoPush = (name, number, kind) => {
    const p = repos.get(name)?.prs.find((p) => p.number === number && p.state === 'OPEN');
    if (!p) throw new Error(`${name}#${number} is not an open pull request`);
    p.headSha = demoCommit(p.headSha ?? 'demo', kind);
    p.updatedAt = new Date().toISOString();
    return p.headSha;
  };
  const plant = () => {
    const start = Date.now() - 5 * 86400_000;
    for (const [name, seed] of Object.entries(SEED)) {
      const issues = seed.issues.map(([title, body, labels], i) => ({
        repo: name,
        number: i + 1,
        title,
        body,
        labels,
        url: `https://github.com/${name}/issues/${i + 1}`,
        author: 'you',
        createdAt: new Date(start + i * 3600_000).toISOString(),
      }));
      const number = issues.length + 1;
      // a teammate's PR, so the board's "only my PRs" filter has something to hide
      const prs: FakeRepo['prs'] = [{
        repo: name,
        number,
        title: 'Tidy up README badges',
        url: `https://github.com/${name}/pull/${number}`,
        branch: 'sam/readme-badges',
        headSha: (number * 0x9e3779b1 >>> 0).toString(16).padStart(8, '0') + '5ab',
        baseBranch: 'main',
        author: 'sam-teammate',
        isDraft: false,
        // one of them conflicts, so there is something to hand to an agent
        mergeable: name === 'demo/webshop-api' ? 'CONFLICTING' : 'MERGEABLE',
        checks: 'passing',
        failedChecks: [],
        closes: [],
        createdAt: new Date(start + 86400_000).toISOString(),
        state: 'OPEN',
      }];
      // pairs of PRs closing feature:-labelled issues in both shop repos, so ▶ Preview has a set to bring along
      for (const [title, closes, hoursAgo] of seed.prs ?? []) {
        const n = number + prs.length;
        prs.push({
          repo: name,
          number: n,
          title,
          url: `https://github.com/${name}/pull/${n}`,
          branch: `focus/${closes}-${title.toLowerCase().replace(/\W+/g, '-').replace(/-$/, '')}-${n}`,
          headSha: (n * 0x85ebca6b >>> 0).toString(16).padStart(8, '0') + 'f00',
          baseBranch: 'main',
          author: 'demo-manager',
          isDraft: false,
          mergeable: 'MERGEABLE',
          checks: 'passing',
          failedChecks: [],
          closes: [closes],
          createdAt: new Date(Date.now() - (hoursAgo + 3) * 3600_000).toISOString(),
          updatedAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
          state: 'OPEN',
          body: `Adds ${title.toLowerCase()}.\n\nCloses #${closes}`,
        });
      }
      repos.set(name, { description: seed.description, issues, prs, nextNumber: number + prs.length });
    }
  };
  plant();

  const repo = (name: string): Effect.Effect<FakeRepo, GitHubNotFound> => {
    const found = repos.get(name);
    return found
      ? Effect.succeed(found)
      : Effect.fail(new GitHubNotFound({ message: `Repository ${name} not found (demo mode knows: ${[...repos.keys()].join(', ')})` }));
  };
  const pr = (name: string, number: number) =>
    repo(name).pipe(
      Effect.flatMap((r): Effect.Effect<FakeRepo['prs'][number], GitHubNotFound> => {
        const found = r.prs.find((p) => p.number === number);
        return found ? Effect.succeed(found) : Effect.fail(new GitHubNotFound({ message: `PR #${number} not found in ${name}` }));
      }),
    );

  return GitHub.of({
    status: Effect.succeed({ ok: true, login: 'demo-manager' }),

    listRepos: Effect.sync(() => [...repos.keys()]),

    repoInfo: (name) =>
      repo(name).pipe(Effect.map((r) => ({ nameWithOwner: name, defaultBranch: 'main', url: `https://github.com/${name}`, description: r.description, isEmpty: false }))),

    listIssues: (name) => repo(name).pipe(Effect.map((r) => [...r.issues])),

    getIssue: (name, number) =>
      repo(name).pipe(
        Effect.flatMap((r) => {
          const issue = r.issues.find((i) => i.number === number);
          return issue ? Effect.succeed({ ...issue, comments: [] }) : Effect.fail(new GitHubNotFound({ message: `Issue #${number} not found in ${name}` }));
        }),
      ),

    createIssue: (name, title, body, labels = []) =>
      repo(name).pipe(
        Effect.map((r) => {
          const number = r.nextNumber++;
          const issue: Issue = {
            repo: name,
            number,
            title,
            body,
            labels,
            url: `https://github.com/${name}/issues/${number}`,
            author: 'demo-manager',
            createdAt: new Date().toISOString(),
          };
          r.issues.push(issue);
          return issue;
        }),
      ),

    listPullRequests: (name) =>
      repo(name).pipe(
        Effect.map((r) =>
          r.prs
            .filter((p) => p.state === 'OPEN')
            .map(({ state: _state, body: _body, comments: _comments, reviewComments: _reviewComments, rerunAt, ...p }): PullRequest => {
              const running = Date.now() - Math.max(Date.parse(p.createdAt), rerunAt ?? 0) < CHECKS_TAKE_MS;
              // every fifth PR has a flaky test: it fails until it's re-run
              if (running) return { ...p, checks: 'pending', failedChecks: [] };
              if (p.number % 5 !== 0 || rerunAt) return { ...p, checks: 'passing', failedChecks: [] };
              const runId = RUN_IDS + p.number;
              return { ...p, checks: 'failing', failedChecks: [{ name: 'CI / test', url: `https://github.com/${name}/actions/runs/${runId}`, runId }] };
            }),
        ),
      ),

    pullRequestsFrom: (name, prefix) =>
      repo(name).pipe(
        Effect.map((r) =>
          r.prs
            .filter((p) => p.branch.startsWith(prefix))
            .reverse()
            .map((p) => ({
              number: p.number, title: p.title, body: p.body ?? '', url: p.url, branch: p.branch, state: p.state, createdAt: p.createdAt,
              comments: (p.comments ?? []).map((body) => ({ author: 'demo-manager', body })),
            })),
        ),
      ),

    // as `gh pr view` does, a number GitHub hasn't got fails: it isn't a closed pull request
    pullRequestState: (name, number) => pr(name, number).pipe(Effect.map((p) => p.state)),

    findPullRequest: (name, branch) =>
      repo(name).pipe(
        Effect.map((r) => {
          const found = r.prs.find((p) => p.branch === branch && p.state === 'OPEN');
          return found ? { number: found.number, url: found.url } : null;
        }),
      ),

    getPullRequest: (name, number) =>
      pr(name, number).pipe(
        Effect.map((p) => {
          const body = p.body ?? 'Tidies up the badges at the top of the README.';
          return {
            number,
            title: p.title,
            body,
            url: p.url,
            branch: p.branch,
            baseBranch: p.baseBranch,
            headSha: p.headSha ?? 'demo',
            author: p.author,
            linkedIssues: closingIssues(body),
          };
        }),
      ),

    commentOnPullRequest: (name, number, body) =>
      pr(name, number).pipe(
        Effect.map((p) => {
          p.comments = [...(p.comments ?? []), body];
          return `${p.url}#issuecomment-${p.comments.length}`;
        }),
      ),

    pullRequestComments: (name, number) => pr(name, number).pipe(Effect.map((p) => [...(p.comments ?? [])])),
    reviewComments: (name, reviewId) =>
      repo(name).pipe(Effect.map((r) => [...(r.prs.find((p) => p.reviewComments?.[reviewId])?.reviewComments?.[reviewId] ?? [])])),

    uploadQaEvidence: (name, path) => repo(name).pipe(Effect.as(evidenceUrl(name, path))),

    createPullRequest: (name, req) =>
      repo(name).pipe(
        Effect.flatMap((r) => {
          // GitHub refuses a second open pull request from the same branch (422 "A pull request already exists")
          const open = r.prs.find((p) => p.branch === req.head && p.state === 'OPEN');
          if (open) return Effect.fail(new GitHubRejected({ message: `A pull request already exists for ${name}:${req.head}: ${open.url}` }));
          return Effect.succeed(opened(r, name, req, false));
        }),
      ),

    mergePullRequest: (name, number, _method, headSha) =>
      Effect.gen(function* () {
        const r = yield* repo(name);
        const p = r.prs.find((p) => p.number === number);
        if (!p || p.state !== 'OPEN') return yield* new GitHubRejected({ message: `PR #${number} is not open` });
        if (headSha && p.headSha && !sameCommit(headSha, p.headSha)) return yield* new GitHubRejected({ message: `Head branch was modified. Review and try the merge again.` });
        p.state = 'MERGED';
        r.issues = r.issues.filter((i) => !p.closes.includes(i.number));
      }),

    editPullRequestBody: (name, number, body) =>
      pr(name, number).pipe(
        Effect.map((p) => {
          p.body = body;
        }),
      ),

    closePullRequest: (name, number, comment) =>
      Effect.gen(function* () {
        const p = yield* pr(name, number);
        if (p.state !== 'OPEN') return yield* new GitHubRejected({ message: `PR #${number} is not open` });
        p.state = 'CLOSED';
        p.comments = [...(p.comments ?? []), comment];
      }),

    pullRequestDiff: (name, number) =>
      pr(name, number).pipe(
        Effect.map((p) => `diff --git a/src/${p.branch}.ts b/src/${p.branch}.ts\n--- a/src/${p.branch}.ts\n+++ b/src/${p.branch}.ts\n@@ -1,3 +1,6 @@\n export function render(state) {\n-  return view(state);\n+  // ${p.title}\n+  return view(withFix(state));\n }\n`),
      ),

    rerunFailedRuns: (name, runIds) =>
      repo(name).pipe(
        Effect.map((r) => {
          for (const p of r.prs) if (runIds.includes(RUN_IDS + p.number)) p.rerunAt = Date.now();
        }),
      ),

    createRepo: (name, opts) =>
      Effect.suspend(() => {
        const full = `${opts.owner || 'demo'}/${name}`;
        if (repos.has(full)) return Effect.fail(new GitHubRejected({ message: `${full} already exists` }));
        repos.set(full, { description: opts.description, issues: [], prs: [], nextNumber: 1 });
        return Effect.succeed(full);
      }),
  });
});
