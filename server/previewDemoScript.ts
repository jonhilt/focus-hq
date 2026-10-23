// What a demo preview pretends to do (previews.ts plays it): which repos it checks out, and what it prints, after how
// long, as it "installs and starts" its sites, which Focus serves itself. A project of several repos gets a stack CLI
// that prints its URLs as JSON, a single repo a Vite dev server.
import type { PreviewCheckout, PreviewSet } from '../shared/types';

/** A stack for a project of several repos (up but not happy for an api repo's PR, to show one off), else a dev server. */
export type DemoKind = 'dev-server' | 'stack' | 'unhealthy-stack';

export const demoKind = (repo: string, repos: string[]): DemoKind => (repos.length < 2 ? 'dev-server' : /api/.test(repo) ? 'unhealthy-stack' : 'stack');

/** After `wait` ms, one of the checkouts lands (by its index), or the command prints a line (a JSON one is its result). */
export type DemoStep = { wait: number; checkout: number } | { wait: number; line: string };

export interface DemoScript {
  command: string;
  checkouts: PreviewCheckout[];
  steps: DemoStep[];
  /** How the command exits once the script has played: a stack's CLI exits, a dev server keeps running. */
  exit?: number;
}

/** A demo preview's script. `focus` is where Focus serves the stand-in sites; `logs`, a stack's log folder. */
export function demoScript(
  preview: { repo: string; number: number; set: PreviewSet },
  repos: string[],
  kind: DemoKind,
  focus: { host: string; port: number },
  logs?: string,
): DemoScript {
  const { repo, number } = preview;
  const stack = kind !== 'dev-server';
  const page = (site: string) => `http://${focus.host === '0.0.0.0' ? 'localhost' : focus.host}:${focus.port}/demo-preview/${repo}/${number}?site=${site}`;
  // a stack uses every repo of the project, the dev server only the PR's
  const checkouts = (stack ? [repo, ...repos.filter((r) => r !== repo)] : [repo]).map((r): PreviewCheckout => {
    const pr = r === repo ? number : preview.set[r];
    return { repo: r, ref: pr != null ? { pr } : { branch: 'main' } };
  });
  const say = (wait: number, line: string): DemoStep => ({ wait, line });
  const fetched = checkouts.map((_, checkout): DemoStep => ({ wait: stack ? 300 : 400, checkout }));
  if (!stack) {
    const command = 'npm install && npm run dev';
    return {
      command,
      checkouts,
      steps: [
        ...fetched,
        say(200, `$ ${command}`),
        say(1400, 'added 312 packages, and audited 313 packages in 3s'),
        say(300, `> ${repo.split('/')[1] ?? repo}@0.0.0 dev`),
        say(200, '> vite'),
        say(900, '  VITE v6.3.5  ready in 412 ms'),
        say(100, `  ➜  Local:   ${page('web')}`),
        say(50, '  ➜  press h + enter to show help'),
      ],
    };
  }
  const command = './scripts/stack up';
  const unhealthy = kind === 'unhealthy-stack';
  return {
    command,
    checkouts,
    steps: [
      ...fetched,
      say(100, `$ ${command}`),
      ...['install', 'database-migrate', 'api-build', 'readiness'].map((phase) => say(700, JSON.stringify({ status: 'starting', phase }))),
      say(400, JSON.stringify({ status: unhealthy ? 'unhealthy' : 'ready', urls: { api: page('api'), web: page('web') }, logs, phase: 'running' }, null, 2)),
    ],
    exit: unhealthy ? 1 : 0,
  };
}
