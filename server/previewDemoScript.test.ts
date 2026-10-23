import { describe, expect, it } from 'vitest';
import { demoKind, demoScript, type DemoStep } from './previewDemoScript';

const focus = { host: '0.0.0.0', port: 4477 };
const lines = (steps: DemoStep[]) => steps.flatMap((s) => ('line' in s ? [s.line] : []));

describe('demoKind', () => {
  it('runs a dev server for one repo, and a stack for several: unhappy for an api repo’s PR', () => {
    expect(demoKind('demo/web', ['demo/web'])).toBe('dev-server');
    expect(demoKind('demo/web', ['demo/web', 'demo/api'])).toBe('stack');
    expect(demoKind('demo/api', ['demo/web', 'demo/api'])).toBe('unhealthy-stack');
  });
});

describe('demoScript', () => {
  it('checks out only the PR’s repo for a dev server, then prints where it serves, and keeps running', () => {
    const script = demoScript({ repo: 'demo/web', number: 12, set: {} }, ['demo/web'], 'dev-server', focus);
    expect(script.checkouts).toEqual([{ repo: 'demo/web', ref: { pr: 12 } }]);
    expect(script.steps[0]).toEqual({ wait: 400, checkout: 0 });
    expect(lines(script.steps)).toContain('  ➜  Local:   http://localhost:4477/demo-preview/demo/web/12?site=web');
    expect(script.exit).toBeUndefined();
  });

  it('checks out every repo for a stack, the PR’s first, each at its pick or main', () => {
    const script = demoScript({ repo: 'demo/web', number: 12, set: { 'demo/api': 7, 'demo/docs': null } }, ['demo/api', 'demo/web', 'demo/docs'], 'stack', { host: 'ship.local', port: 80 });
    expect(script.checkouts).toEqual([
      { repo: 'demo/web', ref: { pr: 12 } },
      { repo: 'demo/api', ref: { pr: 7 } },
      { repo: 'demo/docs', ref: { branch: 'main' } },
    ]);
    expect(script.steps.slice(0, 3)).toEqual([0, 1, 2].map((checkout) => ({ wait: 300, checkout })));
  });

  it('ends a stack on its JSON result, with its links and logs, and exits 0, or 1 when it’s unhealthy', () => {
    const result = (kind: 'stack' | 'unhealthy-stack') => {
      const script = demoScript({ repo: 'demo/api', number: 3, set: {} }, ['demo/api', 'demo/web'], kind, { host: 'ship.local', port: 80 }, '/logs');
      return { result: JSON.parse(lines(script.steps).at(-1) ?? '{}'), exit: script.exit };
    };
    expect(result('stack')).toEqual({
      result: { status: 'ready', urls: { api: 'http://ship.local:80/demo-preview/demo/api/3?site=api', web: 'http://ship.local:80/demo-preview/demo/api/3?site=web' }, logs: '/logs', phase: 'running' },
      exit: 0,
    });
    expect(result('unhealthy-stack')).toMatchObject({ result: { status: 'unhealthy' }, exit: 1 });
  });
});
