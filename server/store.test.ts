import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Agent, QaReview } from '../shared/types';

// paths come from the environment when config.ts loads, so the data folder is set before the store is imported
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-store-'));
process.env.FOCUS_DATA_DIR = dir;
const { agentAfterRestart, reviewAfterRestart, StateLockedError, Store, stateLocked } = await import('./store');
const { seedOffice, seedRandom } = await import('./util');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Store on disk', () => {
  it('won’t open a data folder another live office holds', () => {
    fs.writeFileSync(path.join(dir, 'state.json.lock'), String(process.ppid));
    expect(() => new Store(true).load()).toThrow(stateLocked(process.ppid, dir));
    // index.ts tells this refusal from a crash by its type, and prints just its message
    let refusal: unknown;
    try {
      new Store(true).load();
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toBeInstanceOf(StateLockedError);
    expect(refusal).toMatchObject({ pid: process.ppid, dataDir: dir, message: stateLocked(process.ppid, dir) });
    fs.rmSync(path.join(dir, 'state.json.lock'));
  });

  it('takes over a lock left by an office that’s gone, and flushes a waiting save at once', () => {
    fs.writeFileSync(path.join(dir, 'state.json.lock'), '999999');
    const store = new Store(true);
    store.load();
    expect(fs.readFileSync(path.join(dir, 'state.json.lock'), 'utf8')).toBe(String(process.pid));
    store.addProject('Focus');
    store.flush();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) as { projects: { name: string }[] };
    expect(saved.projects.map((p) => p.name)).toEqual(['Focus']);
  });
});

describe('a repo’s merge method', () => {
  const store = new Store(false);
  const project = store.addProject('Focus');
  project.repos = ['o/a', 'o/b'];

  it('is set for one repo and cleared back to the office-wide setting', () => {
    store.updateProject(project.id, { mergeMethod: { repo: 'o/a', method: 'rebase' } });
    store.updateProject(project.id, { mergeMethod: { repo: 'o/b', method: 'merge' } });
    expect(project.mergeMethods).toEqual({ 'o/a': 'rebase', 'o/b': 'merge' });
    store.updateProject(project.id, { mergeMethod: { repo: 'o/a', method: '' } });
    expect(project.mergeMethods).toEqual({ 'o/b': 'merge' });
  });

  it('can’t be set for a repo the project hasn’t connected', () => {
    expect(() => store.updateProject(project.id, { name: 'Renamed', mergeMethod: { repo: 'o/c', method: 'squash' } })).toThrow('isn’t connected');
    expect(project.name).toBe('Focus');
  });
});

describe('the demo office’s ids', () => {
  const demoIds = (otherDice: number) => {
    // whatever was rolled before (another test, the office's startup) mustn't matter
    seedRandom(otherDice);
    seedOffice({ demo: true, studio: false }, 1);
    const store = new Store(false);
    return [store.addProject('Sock Shop').id, store.addProject('Space Dodger').id];
  };

  it('are the same each time it starts, so a script can keep using them across a restart', () => {
    const first = demoIds(1);
    expect(demoIds(2)).toEqual(first);
    expect(new Set(first).size).toBe(2);
  });
});

const agent = (a: Partial<Agent> = {}): Agent => ({
  id: 'agent_ab12',
  name: 'Ada',
  avatar: { division: 'command', rank: 'ensign', species: 'human', skin: '#f1c27d', hair: '#222', hairstyle: 'crop', accessory: 'none' },
  projectId: 'p1',
  repo: 'acme/shop',
  task: 'issue',
  issue: { number: 7, title: 'Save items for later', url: 'https://github.com/acme/shop/issues/7' },
  desk: 0,
  status: 'working',
  activity: 'Fixing it',
  branch: 'focus/7-save-items-for-later-ab12',
  baseBranch: 'main',
  costUsd: 0,
  startedAt: 0,
  ...a,
});

describe('agentAfterRestart', () => {
  it('stops an agent who was at work, and drops a permission they were asking for', () => {
    const after = agentAfterRestart(agent({ status: 'working', permission: { id: 'x', tool: 'Bash', summary: 'rm', at: 0 } }), 'Shop');
    expect(after).toMatchObject({ status: 'stopped', activity: expect.stringMatching(/Interrupted when Focus shut down/) });
    expect(after.permission).toBeUndefined();
  });

  it('stops a queued agent too, but leaves one who had finished as they were', () => {
    expect(agentAfterRestart(agent({ status: 'queued' }), 'Shop').status).toBe('stopped');
    expect(agentAfterRestart(agent({ status: 'done', activity: 'PR opened' }), 'Shop')).toMatchObject({ status: 'done', activity: 'PR opened' });
  });

  it('keeps an agent waiting for their cloud session waiting, and stops watching the terminal opened for it', () => {
    const after = agentAfterRestart(agent({ status: 'working', handover: { since: 1, fresh: true, terminalAt: 5 } }), 'Shop');
    expect(after).toMatchObject({ status: 'waiting', activity: 'Waiting for a cloud session', handover: { since: 1, fresh: true } });
    expect(after.handover?.terminalAt).toBeUndefined();
  });

  it('hands one held for the plan’s usage limit to the captain', () => {
    const after = agentAfterRestart(agent({ status: 'done', held: { until: 9 } }), 'Shop');
    expect(after.held).toBeUndefined();
    expect(after.activity).toMatch(/usage limit when Focus shut down/);
  });

  it('forgets a lead’s subagents, workflows and background work, which don’t outlive the office', () => {
    const after = agentAfterRestart(agent({ status: 'done', helpers: [], workflows: [], background: [] }), 'Shop');
    expect(after).not.toHaveProperty('helpers', expect.anything());
    expect(after).not.toHaveProperty('workflows', expect.anything());
    expect(after).not.toHaveProperty('background', expect.anything());
  });

  it('gives an agent saved before tasks an issue task, and one saved before uniforms a uniform', () => {
    const old = agent({ status: 'done', avatar: { skin: '#fff' } as never });
    delete (old as Partial<Agent>).task;
    const after = agentAfterRestart(old, 'Shop');
    expect(after.task).toBe('issue');
    expect(after.avatar).toHaveProperty('division');
  });

  it('dresses an old QA officer as their room’s QA officer', () => {
    const after = agentAfterRestart(agent({ status: 'done', task: 'review', avatar: { skin: '#fff' } as never }), 'Shop');
    expect(after.avatar).toHaveProperty('division');
  });

  it('seats a lead saved before team stations at the first, named for its project', () => {
    const lead = agent({ status: 'done', task: 'lead', lead: { title: '' } as never });
    expect(agentAfterRestart(lead, 'Shop').lead).toMatchObject({ station: 0, title: 'Shop’s first goal' });
  });

  it('leaves what it was given alone', () => {
    const saved = agent({ status: 'working', held: { until: 9 } });
    agentAfterRestart(saved, 'Shop');
    expect(saved).toMatchObject({ status: 'working', held: { until: 9 } });
  });
});

describe('reviewAfterRestart', () => {
  const review = (r: Partial<QaReview>): QaReview => ({ projectId: 'p', repo: 'o/r', number: 1, title: 't', status: 'passed', requestedAt: 0, ...r });

  it('ends a review that was queued or under way, so it can be sent again', () => {
    for (const status of ['queued', 'testing'] as const) {
      expect(reviewAfterRestart(review({ status }))).toMatchObject({ status: 'error', error: expect.stringMatching(/Send it to QA again/) });
    }
    expect(reviewAfterRestart(review({ status: 'failed' })).status).toBe('failed');
  });

  it('hands a PR the operations officer was looking at to the captain', () => {
    const after = reviewAfterRestart(review({ followUp: { kind: 'triaging', officer: 'Lt. Ops', activity: 'Reading the checks' } }));
    expect(after.followUp).toEqual({ kind: 'needs-you', reason: 'Lt. Ops was looking at it when Focus shut down' });
  });

  it('leaves what it was given alone', () => {
    const saved = review({ status: 'testing' });
    reviewAfterRestart(saved);
    expect(saved.status).toBe('testing');
  });
});
