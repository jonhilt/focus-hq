import { describe, expect, it } from 'vitest';
import { busyNote, updateBlocked, updatePlan } from './updater';

describe('updateBlocked', () => {
  it('lets a clean checkout behind its upstream fast-forward', () => {
    expect(updateBlocked({ ahead: 0, behind: 3, dirty: false, upstream: 'origin/main' })).toBeNull();
  });

  it('explains local commits and how to clear them', () => {
    const why = updateBlocked({ ahead: 1, behind: 2, dirty: false, upstream: 'origin/main' });
    expect(why).toContain('1 commit that origin/main');
    expect(why).toContain('2 commits behind');
    expect(why).toContain('git pull --rebase');
  });

  it('explains uncommitted changes', () => {
    expect(updateBlocked({ ahead: 0, behind: 1, dirty: true, upstream: 'origin/main' })).toContain('uncommitted changes');
  });
});

describe('busyNote', () => {
  it('says nothing when no agent is busy', () => {
    expect(busyNote([{ status: 'done' }, { status: 'error' }, { status: 'stopped' }])).toBeUndefined();
  });

  it('waits for a queued or working agent, counting them', () => {
    expect(busyNote([{ status: 'working' }, { status: 'done' }])).toContain('once the busy agent finishes');
    expect(busyNote([{ status: 'queued' }, { status: 'waiting' }, { status: 'pushing' }])).toContain('once all 3 busy agents finish');
  });
});

describe('updatePlan', () => {
  it('builds a production Focus, and installs only when the dependencies changed', () => {
    expect(updatePlan({ lockfiles: ['pnpm-lock.yaml', 'package.json'], changed: ['server/index.ts'], dev: false })).toEqual({ pm: 'pnpm', build: true });
    expect(updatePlan({ lockfiles: ['pnpm-lock.yaml'], changed: ['pnpm-lock.yaml'], dev: false })).toEqual({ pm: 'pnpm', install: ['pnpm', 'install', '--frozen-lockfile'], build: true });
  });

  it('leaves the build to Vite in dev mode', () => {
    expect(updatePlan({ lockfiles: ['yarn.lock'], changed: ['package.json'], dev: true })).toEqual({ pm: 'yarn', install: ['yarn', 'install', '--frozen-lockfile'], build: false });
  });

  it('runs a plain npm install without a lockfile', () => {
    expect(updatePlan({ lockfiles: ['package.json'], changed: ['package.json'], dev: true })).toEqual({ pm: 'npm', install: ['npm', 'install'], build: false });
  });
});
