import { describe, expect, it } from 'vitest';
import type { QueuedGoal, ServerEvent, Snapshot } from '../shared/types';
import type { AgentManager } from './agents/manager';
import type { Hub } from './hub';
import { Store } from './store';
import { clearForTraining, sceneFor, type SceneFile, startTraining, type TrainingShip } from './training';

function busyStore(): Store {
  const store = new Store(false);
  const shop = store.addProject('Sock Shop', '#ff8a5b', 'beach');
  shop.repos = ['demo/webshop-frontend', 'demo/webshop-api'];
  shop.goalQueue = [{ id: 'q1', text: 'An old goal', at: 1 }];
  shop.goals = [{ id: 'g1' } as NonNullable<typeof shop.goals>[number]];
  store.ledger = [{ type: 'pr-opened' } as never];
  store.reviews.set('demo/webshop-api#4', {} as never);
  return store;
}

/** A ship whose crew go home when asked and whose steps are written down in order. */
function ship(store: Store, scenes: SceneFile[] = []) {
  const steps: string[] = [];
  const sent: ServerEvent[] = [];
  store.agents.set('lead_1', { id: 'lead_1' } as never);
  const agents = {
    dismiss: (id: string) => {
      steps.push(`home ${id}`);
      store.agents.delete(id);
      // going home leaves a digest in the ledger, which the reset clears after
      store.ledger.push({ type: 'session' } as never);
      return Promise.resolve();
    },
    queueGoal: (projectId: string, text: string): QueuedGoal => {
      steps.push(`queue ${text}`);
      const queued = { id: 'q2', text, at: 2 };
      store.project(projectId).goalQueue = [queued];
      return queued;
    },
  } as unknown as AgentManager;
  const training: TrainingShip = {
    store,
    hub: { send: (e: ServerEvent) => sent.push(e) } as unknown as Hub,
    agents,
    resetGitHub: () => steps.push('github'),
    setScenario: (s) => steps.push(`scenario ${s}`),
    refreshBoards: () => (steps.push('boards'), Promise.resolve()),
    snapshot: () => Promise.resolve({ agents: [...store.agents.values()] } as unknown as Snapshot),
    scenes: () => Promise.resolve(scenes),
  };
  return { training, steps, sent };
}

describe('clearForTraining', () => {
  it('clears goals, the line, reviews and the log, and keeps the projects', () => {
    const store = busyStore();
    clearForTraining(store);
    expect(store.projects.map((p) => [p.name, p.repos.length, p.goalQueue, p.goals])).toEqual([['Sock Shop', 2, [], []]]);
    expect(store.ledger).toEqual([]);
    expect(store.reviews.size).toBe(0);
  });
});

describe('startTraining', () => {
  it('sends everyone home, then clears the ship and readies the scenario’s goal', async () => {
    const store = busyStore();
    const { training, steps, sent } = ship(store);
    const ready = await startTraining('workflow', training);
    expect(steps).toEqual(['home lead_1', 'github', 'scenario workflow', 'boards', 'queue Show how many of each sock are left in stock on the product page']);
    expect(store.ledger).toEqual([]);
    expect(ready).toMatchObject({ projectId: store.projects[0].id, queued: { id: 'q2' } });
    expect(sent).toEqual([{ type: 'snapshot', snapshot: { agents: [] } }]);
  });

  it('says so when the scenario’s project is missing', async () => {
    const store = new Store(false);
    await expect(startTraining('full', ship(store).training)).rejects.toThrow(/no project called Sock Shop/);
  });

  it('takes the goal from the scene that plays the scenario, and hands the scene back', async () => {
    const store = busyStore();
    const raw = { title: 'Ep', goal: 'Socks come in pairs', scenario: 'subagents', seed: 3, beats: [{ title: 'Go', caption: 'Go', do: 'start-goal' }] };
    const { training, steps } = ship(store, [{ name: 'subagents', raw }]);
    const ready = await startTraining('subagents', training);
    expect(steps.at(-1)).toBe('queue Socks come in pairs');
    expect(ready.scene).toEqual({ name: 'subagents', raw });
  });
});

describe('sceneFor', () => {
  const scene = (name: string, scenario?: string): SceneFile => ({ name, raw: { title: name, goal: 'G', scenario, beats: [{ title: 'B', caption: 'C' }] } });

  it('finds the first scene, by name, that plays the scenario', () => {
    expect(sceneFor('workflow', [scene('b', 'workflow'), scene('a', 'workflow'), scene('c', 'subagents')])?.name).toBe('a');
  });

  it('counts a scene without a scenario as the full story, and passes over one that doesn’t read', () => {
    expect(sceneFor('full', [{ name: 'broken', raw: { title: 'x' } }, scene('plain')])?.name).toBe('plain');
    expect(sceneFor('subagents', [scene('plain')])).toBeUndefined();
  });
});
