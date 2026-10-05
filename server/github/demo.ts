import type { GitHubStatus, Issue, PullRequest } from '../../shared/types';
import { closingIssues, type CreatePullRequest, type GitHubProvider, type IssueDetail, type PullRequestDetail, type RepoInfo } from './provider';

interface FakeRepo {
  description: string;
  issues: Issue[];
  prs: (PullRequest & { state: 'OPEN' | 'CLOSED' | 'MERGED'; closes?: number; body?: string; comments?: string[] })[];
  nextNumber: number;
}

const SEED: Record<string, { description: string; issues: [string, string, string[]][] }> = {
  'demo/webshop-frontend': {
    description: 'Storefront for the cartoon sock shop',
    issues: [
      ['Add a dark mode toggle to the header', 'Users want a dark theme. Persist the choice in localStorage.', ['enhancement']],
      ['Cart badge does not update after removing an item', 'Steps: add 2 items, remove 1, badge still says 2.', ['bug']],
      ['Product page images are blurry on retina screens', 'Serve 2x images via srcset.', ['bug']],
      ['Add "Recently viewed" carousel to the home page', 'Show the last 6 products the visitor opened.', ['enhancement']],
      ['Checkout button should be disabled while submitting', 'Double clicks create duplicate orders.', ['bug']],
    ],
  },
  'demo/webshop-api': {
    description: 'REST API for the sock shop',
    issues: [
      ['Rate limit the /login endpoint', 'Max 10 attempts per minute per IP.', ['security']],
      ['Add pagination to GET /products', 'Support ?page and ?pageSize, default 20.', ['enhancement']],
      ['Orders endpoint returns 500 for empty carts', 'Should be a 422 with a helpful message.', ['bug']],
    ],
  },
  'demo/space-dodger': {
    description: 'A tiny browser game about dodging asteroids',
    issues: [
      ['Add a high score table', 'Keep the top 10 scores in localStorage and show them on game over.', ['enhancement']],
      ['Ship clips through asteroids at high speed', 'Collision check misses fast frames; use swept collision.', ['bug']],
      ['Add sound effects with a mute button', 'Explosion + thruster sounds. Mute toggle in the corner.', ['enhancement']],
      ['Pause the game when the tab is hidden', 'Use the visibilitychange event.', ['enhancement']],
    ],
  },
};

/** In-memory GitHub used by `npm run demo`. */
export class DemoGitHub implements GitHubProvider {
  private repos = new Map<string, FakeRepo>();

  constructor() {
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
        createdAt: new Date(start + 86400_000).toISOString(),
        state: 'OPEN',
      }];
      this.repos.set(name, { description: seed.description, issues, prs, nextNumber: number + 1 });
    }
  }

  private repo(name: string): FakeRepo {
    const repo = this.repos.get(name);
    if (!repo) throw new Error(`Repository ${name} not found (demo mode knows: ${[...this.repos.keys()].join(', ')})`);
    return repo;
  }

  async status(): Promise<GitHubStatus> {
    return { ok: true, login: 'demo-manager' };
  }

  async listRepos(): Promise<string[]> {
    return [...this.repos.keys()];
  }

  async repoInfo(name: string): Promise<RepoInfo> {
    const repo = this.repo(name);
    return { nameWithOwner: name, defaultBranch: 'main', url: `https://github.com/${name}`, description: repo.description, isEmpty: false };
  }

  async listIssues(name: string): Promise<Issue[]> {
    return [...this.repo(name).issues];
  }

  async getIssue(name: string, number: number): Promise<IssueDetail> {
    const issue = this.repo(name).issues.find((i) => i.number === number);
    if (!issue) throw new Error(`Issue #${number} not found in ${name}`);
    return { ...issue, comments: [] };
  }

  async createIssue(name: string, title: string, body: string, labels: string[] = []): Promise<Issue> {
    const repo = this.repo(name);
    const number = repo.nextNumber++;
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
    repo.issues.push(issue);
    return issue;
  }

  async listPullRequests(name: string): Promise<PullRequest[]> {
    return this.repo(name)
      .prs.filter((p) => p.state === 'OPEN')
      .map(({ state: _state, closes: _closes, ...pr }) => {
        // Checks "finish" a little while after the PR is opened.
        const age = Date.now() - Date.parse(pr.createdAt);
        return { ...pr, checks: age < 20_000 ? 'pending' : pr.number % 5 === 0 ? 'failing' : 'passing' };
      });
  }

  async pullRequestState(name: string, number: number): Promise<'OPEN' | 'CLOSED' | 'MERGED'> {
    return this.repo(name).prs.find((p) => p.number === number)?.state ?? 'CLOSED';
  }

  async findPullRequest(name: string, branch: string) {
    const pr = this.repo(name).prs.find((p) => p.branch === branch && p.state === 'OPEN');
    return pr ? { number: pr.number, url: pr.url } : null;
  }

  async getPullRequest(name: string, number: number): Promise<PullRequestDetail> {
    const pr = this.repo(name).prs.find((p) => p.number === number);
    if (!pr) throw new Error(`PR #${number} not found in ${name}`);
    const body = pr.body ?? 'Tidies up the badges at the top of the README.';
    return {
      number,
      title: pr.title,
      body,
      url: pr.url,
      branch: pr.branch,
      baseBranch: pr.baseBranch,
      headSha: pr.headSha ?? 'demo',
      author: pr.author,
      linkedIssues: closingIssues(body),
    };
  }

  async commentOnPullRequest(name: string, number: number, body: string): Promise<string> {
    const pr = this.repo(name).prs.find((p) => p.number === number);
    if (!pr) throw new Error(`PR #${number} not found in ${name}`);
    pr.comments = [...(pr.comments ?? []), body];
    return `${pr.url}#issuecomment-${pr.comments.length}`;
  }

  async createPullRequest(name: string, req: CreatePullRequest) {
    const repo = this.repo(name);
    const number = repo.nextNumber++;
    const closes = /Closes #(\d+)/.exec(req.body);
    const pr = {
      repo: name,
      number,
      title: req.title,
      url: `https://github.com/${name}/pull/${number}`,
      branch: req.head,
      baseBranch: req.base,
      author: 'demo-manager',
      isDraft: false,
      mergeable: 'MERGEABLE' as const,
      checks: 'pending' as const,
      createdAt: new Date().toISOString(),
      state: 'OPEN' as const,
      closes: closes ? Number(closes[1]) : undefined,
      body: req.body,
      headSha: Math.random().toString(16).slice(2, 12).padEnd(10, '0'),
    };
    repo.prs.push(pr);
    return { number, url: pr.url };
  }

  async mergePullRequest(name: string, number: number): Promise<void> {
    const repo = this.repo(name);
    const pr = repo.prs.find((p) => p.number === number);
    if (!pr || pr.state !== 'OPEN') throw new Error(`PR #${number} is not open`);
    pr.state = 'MERGED';
    if (pr.closes) repo.issues = repo.issues.filter((i) => i.number !== pr.closes);
  }

  async createRepo(name: string, opts: { owner?: string; private: boolean; description: string }): Promise<string> {
    const full = `${opts.owner || 'demo'}/${name}`;
    if (this.repos.has(full)) throw new Error(`${full} already exists`);
    this.repos.set(full, { description: opts.description, issues: [], prs: [], nextNumber: 1 });
    return full;
  }
}
