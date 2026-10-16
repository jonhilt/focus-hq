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
// each store opened on disk saves and lets go of its locks on exit: a few of them here, as a few restarts
process.setMaxListeners(20);

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

  it('keeps each agent’s run journal on disk as it goes, and drops a last line Focus stopped part way through', () => {
    const store = new Store(true);
    store.load();
    store.putAgent(agent({ id: 'journaled', status: 'working' }));
    store.journal('journaled', { kind: 'queued', text: 'Fix the flaky test', at: 'end' });
    store.journal('journaled', { kind: 'turn-requested', turn: 't1', turnKind: 'work', prompt: 'Go', resumes: 's1' });
    // on disk already, before any save of the state
    const file = path.join(dir, 'runs', 'journaled.jsonl');
    expect(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
    fs.appendFileSync(file, '{"v":1,"seq":3,"kind":"tu');
    store.flush();

    const again = new Store(true);
    again.load();
    expect(again.run('journaled')).toMatchObject({ inbox: ['Fix the flaky test'], open: { id: 't1', resumes: 's1' }, seq: 2 });
    expect(fs.readFileSync(file, 'utf8').endsWith('}\n')).toBe(true);
    expect(again.journal('journaled', { kind: 'taken' }).seq).toBe(3);

    // sent home, and the id back later (a goal reopened): it starts from nothing, numbering on from its journal
    again.removeAgent('journaled');
    again.flush();
    const later = new Store(true);
    later.load();
    expect(later.run('journaled')).toEqual({ inbox: [], later: [], owed: [], turns: 0, phase: 'idle', seq: 4 });
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

describe('loading a saved office', () => {
  it('picks up every saved agent and review as a restart leaves them, and fits old rooms to today’s desks', () => {
    const project = { id: 'p1', name: 'Shop', color: '#fff', theme: 'beach', repos: ['acme/shop'], maxAgents: 6, autoAssign: false, autoLabel: '', createdAt: 0 };
    const state = {
      settings: { maxConcurrent: 2 },
      projects: [project],
      agents: [agent({ status: 'working', desk: 5 })],
      reviews: [{ projectId: 'p1', repo: 'acme/shop', number: 3, title: 't', status: 'testing', requestedAt: 0 }],
      closedPrs: [{ repo: 'acme/shop', issue: 7, pr: 3, officer: 'Lt. Ops', note: 'Wrong approach', at: 0 }],
      // saved before Number One was a plugin: a chat with something in it moves into the plugin's slot
      numberOne: { status: 'thinking', activity: '', messages: [{ from: 'manager', text: 'Hi', at: 0 }], updatedAt: 0, costUsd: 0 },
      studio: { status: 'thinking', activity: '', messages: [], takes: [], updatedAt: 0, costUsd: 0 },
      // saved before the retro was a plugin: it moves into the plugin's slot, which ends it as the plugin starts
      retro: { status: 'thinking', activity: '', days: 14, sessions: 0, drafts: [], watch: [], costUsd: 0 },
    };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
    const store = new Store(true);
    store.load();
    expect(store.settings).toMatchObject({ maxConcurrent: 2, mergeMethod: 'squash' });
    expect(store.projects[0]?.maxAgents).toBe(2);
    expect(store.agents.get('agent_ab12')).toMatchObject({ status: 'stopped', desk: expect.any(Number) });
    expect(store.agents.get('agent_ab12')?.desk).toBeLessThan(2);
    expect(store.reviews.get('acme/shop#3')?.status).toBe('error');
    expect(store.closedPrs.get('acme/shop#7')?.pr).toBe(3);
    expect(store.studio.status).toBe('failed');
    expect(store.plugins).toEqual({ retro: state.retro, 'number-one': { chat: state.numberOne } });
  });
});

describe('a project’s plugins', () => {
  const store = new Store(false);
  const project = store.addProject('Focus');

  it('are switched on and off one at a time', () => {
    store.updateProject(project.id, { plugin: { id: 'cartography', on: true } });
    store.updateProject(project.id, { plugin: { id: 'flow', on: true } });
    expect(project.plugins).toEqual(['cartography', 'flow']);
    store.updateProject(project.id, { plugin: { id: 'cartography', on: false } });
    expect(project.plugins).toEqual(['flow']);
  });

  it('refuse a bad id before anything changes', () => {
    expect(() => store.updateProject(project.id, { name: 'Renamed', plugin: { id: 'No Such', on: true } })).toThrow('isn’t a plugin’s id');
    expect(project.name).toBe('Focus');
  });
});
