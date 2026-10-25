import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { WAIT_BIN } from './wait';
import { pushDenial, pushGuardEnv, refusedPushes, writePushHooks } from './pushGuard';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-push-guard-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
vi.setConfig({ testTimeout: 30_000 });

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** An origin with main, and a lead's clone of it whose repo has a pre-push hook of its own (as husky would set up). */
function leadClone() {
  const origin = path.join(tmp, 'origin.git');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  const dir = path.join(tmp, 'lead');
  git(tmp, 'clone', '-q', origin, dir);
  git(dir, 'config', 'user.email', 'lead@focus.test');
  git(dir, 'config', 'user.name', 'Lead');
  git(dir, 'checkout', '-qb', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-qm', 'a');
  git(dir, 'push', '-q', 'origin', 'main');
  fs.mkdirSync(path.join(dir, '.hooks'));
  fs.writeFileSync(path.join(dir, '.hooks', 'pre-push'), `#!/bin/sh\ncat > /dev/null\necho ran >> "${path.join(tmp, 'own-hook-ran')}"\n`, { mode: 0o755 });
  git(dir, 'config', 'core.hooksPath', '.hooks');
  return dir;
}

describe('the push guard on a lead’s pushes', () => {
  const dir = leadClone();
  const hooks = path.join(tmp, 'git-hooks');
  writePushHooks(hooks);
  const refused = path.join(tmp, 'refused');
  fs.writeFileSync(refused, refusedPushes({ repos: [{ baseBranch: 'main' }], prs: [{ branch: 'fix/old', outcome: 'merged' }, { branch: 'fix/closed', outcome: 'closed' }] }));
  const env = { ...process.env, ...pushGuardEnv(hooks, refused, process.env), PATH: `${WAIT_BIN}${path.delimiter}${process.env.PATH}` };
  const push = (branch: string) => {
    git(dir, 'checkout', '-qB', branch, 'main');
    fs.writeFileSync(path.join(dir, `${branch.replace('/', '-')}.txt`), branch);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', branch);
    return spawnSync('git', ['push', '-q', 'origin', branch], { cwd: dir, env, encoding: 'utf8' });
  };
  const ownHookRuns = () => (fs.existsSync(path.join(tmp, 'own-hook-ran')) ? fs.readFileSync(path.join(tmp, 'own-hook-ran'), 'utf8').split('\n').filter(Boolean).length : 0);

  it('refuses a push to a base branch, saying how to carry on', () => {
    const r = push('main');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Refused by Ops: main is a base branch');
  });

  it('refuses a push to a branch whose PR already merged, saying how to carry on', () => {
    const r = push('fix/old');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Refused by Ops: fix/old’s pull request already merged');
    expect(r.stderr).toContain('cherry-pick');
  });

  it('lets a push to the lead’s own branch through, and the repo’s own pre-push hook still runs', () => {
    const before = ownHookRuns();
    expect(push('fix/new').status).toBe(0);
    expect(push('fix/closed').status).toBe(0);
    expect(git(dir, 'ls-remote', '--heads', 'origin')).toContain('refs/heads/fix/new');
    expect(ownHookRuns()).toBe(before + 2);
  });

  it('refuses every push once the goal is closing, and counts a branch merged in an earlier slice', () => {
    const lines = refusedPushes({ closeStarted: { at: 1 }, repos: [{ baseBranch: 'main' }], prs: [], landed: [{ branch: 'fix/earlier', outcome: 'merged' }] });
    expect(lines).toBe('closing\nbase main\nmerged fix/earlier\n');
    fs.writeFileSync(refused, lines);
    const r = push('fix/late');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Refused by Ops: the goal is closing');
    fs.writeFileSync(refused, refusedPushes({ repos: [{ baseBranch: 'main' }], prs: [{ branch: 'fix/old', outcome: 'merged' }, { branch: 'fix/closed', outcome: 'closed' }] }));
  });

  it('refuses a command that would skip the hooks', () => {
    expect(pushDenial('git push --no-verify origin fix/new')).toMatch(/^Refused by Ops/);
    expect(pushDenial('git -c core.hooksPath=/dev/null push origin fix/new')).toMatch(/^Refused by Ops/);
    expect(pushDenial('git push origin fix/new')).toBeNull();
    expect(pushDenial('git commit --no-verify -m wip')).toBeNull();
  });
});
